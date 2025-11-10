# Fix: XHR Download Abort Not Preventing Mark as Complete

## Problem Statement

When a user clicked "Stop Download" while a video was being downloaded via XHR, the download was successfully aborted and the XHR request was cancelled. However, the video was still incorrectly marked as "已下载" (downloaded) in the database.

### Example Issue

From the logs:
```
injected.js:975 📥 下载进度: 82.7% (7.00MB / 8.46MB)
content.js:115 📥 Content script收到中断下载请求
injected.js:62 🔪 正在中断当前XMLHttpRequest...
injected.js:64 ✅ XMLHttpRequest已成功中断
injected.js:1045 🛑 下载被用户中断
```

Despite the successful XHR abort, the file was still marked as downloaded in the database.

## Root Cause

The issue was a **missing signal in the message chain** when a download was aborted:

1. **background.js** sends download request to **content.js**
2. **content.js** immediately responds with `{ success: true }` without waiting for injected.js to complete
3. **background.js** receives success and sets up a 5-second delayed marking timeout
4. **injected.js** aborts the XHR and catches the AbortError
5. **injected.js** silently returns, never signaling back to **content.js** or **background.js**
6. **background.js** delayed marking timeout fires after 5 seconds and marks video as downloaded

The problem: `stoppedDownloadIds` is never populated with the aborted download's ID because no one tells background.js that the download was aborted.

## Solution Overview

Implement a **completion signal system** so injected.js can report the final status (success/aborted/error) back through content.js to background.js.

### Message Flow

**Before (Broken)**:
```
background.js  →  content.js  →  injected.js
                    ↓ (immediate success, no wait)
background.js receives success, sets delayed marking
                    ↓ (after 5 seconds)
Video marked as downloaded regardless of abort
```

**After (Fixed)**:
```
background.js  →  content.js  →  injected.js
                    (waits for completion signal)
injected.js performs download/abort
                    ↓ (sends downloadComplete signal)
content.js receives signal, includes abort status
                    ↓ (sends response with aborted flag)
background.js checks aborted flag, adds to stoppedDownloadIds
Delayed marking timeout never executes
```

## Implementation Details

### 1. content.js Changes

**Before**: Immediately returned success without waiting for injected.js

```javascript
window.postMessage({ action: 'downloadVideo', ... }, '*');
sendResponse({ success: true, downloadId: ... });
```

**After**: Waits for downloadComplete signal from injected.js

```javascript
const downloadPromise = new Promise((resolveDownload) => {
  // Setup listener for downloadComplete from injected.js
  const handleDownloadResult = (event) => {
    if (event.data.action === 'downloadComplete' && 
        event.data.downloadId === downloadId) {
      window.removeEventListener('message', handleDownloadResult);
      resolveDownload(event.data);  // Resolves with {status, downloadId}
    }
  };
  
  window.addEventListener('message', handleDownloadResult);
  
  // Set 30-second timeout to prevent hanging
  setTimeout(() => {
    window.removeEventListener('message', handleDownloadResult);
    resolveDownload({ status: 'timeout', downloadId });
  }, 30000);
  
  // Send download request to injected.js
  window.postMessage({ action: 'downloadVideo', ... }, '*');
});

// Wait for promise to resolve
downloadPromise.then((result) => {
  // If download was aborted, include aborted flag
  if (result.status === 'aborted') {
    sendResponse({ success: true, aborted: true, ... });
  } else {
    sendResponse({ success: true, ... });
  }
});
```

Key features:
- Waits for `downloadComplete` message from injected.js
- Includes a 30-second timeout to prevent hanging if message is lost
- Checks `result.status` to determine if download was aborted
- Returns `{ success: true, aborted: true }` when aborted

### 2. injected.js Changes

**Before**: Silently returned without notifying content.js

```javascript
try {
  // ... download logic ...
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('🛑 下载被用户中断');
    return;  // Silent return!
  }
}
```

**After**: Sends completion signal with status to content.js

```javascript
try {
  // ... download logic ...
  
  // Download succeeded
  window.postMessage({
    type: 'FROM_DOUYIN_PAGE',
    action: 'downloadComplete',
    downloadId: downloadId,
    status: 'success'
  }, '*');
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('🛑 下载被用户中断');
    
    // Send abort signal
    window.postMessage({
      type: 'FROM_DOUYIN_PAGE',
      action: 'downloadComplete',
      downloadId: downloadId,
      status: 'aborted'  // ← Key: Report abort status
    }, '*');
    
    return;
  } else {
    // Send error signal
    window.postMessage({
      type: 'FROM_DOUYIN_PAGE',
      action: 'downloadComplete',
      downloadId: downloadId,
      status: 'error',
      error: error.message
    }, '*');
    
    throw error;
  }
}
```

Key features:
- Sends `downloadComplete` message for all outcomes (success/abort/error)
- Includes `status` field to indicate what happened
- Includes `downloadId` to match with content.js listener

### 3. background.js Changes

**Before**: Didn't check if download was aborted

```javascript
if (response && response.success) {
  console.log('✅ Content script下载请求已发送');
  // Sets up delayed marking immediately
  const markDownloadTimeout = setTimeout(() => {
    // Marks as downloaded after 5 seconds
  }, 5000);
}
```

**After**: Checks abort flag before setting up delayed marking

```javascript
if (response && response.success) {
  console.log('✅ Content script下载请求已发送');
  
  // Check if download was aborted
  if (response.aborted) {
    console.log('🛑 检测到下载被中止，添加到停止列表');
    stoppedDownloadIds.add(downloadId);
    inFlightDownloads.delete(downloadId);
    
    // Throw abort error so download queue continues
    const abortError = new Error('Download aborted by user');
    abortError.name = 'AbortError';
    throw abortError;
  }
  
  // Normal path: set up delayed marking
  const markDownloadTimeout = setTimeout(() => {
    // Marks as downloaded after 5 seconds
  }, 5000);
}
```

Key features:
- Checks `response.aborted` flag
- If aborted, adds ID to `stoppedDownloadIds` BEFORE any delayed marking can occur
- Immediately deletes from `inFlightDownloads` 
- Throws AbortError so download queue skips to next video

## How It Fixes the Issue

1. **User clicks Stop Download** while XHR is at 82.7%
2. **stopDownload handler** in background.js sends abort signal to content.js
3. **content.js** forwards abort signal to injected.js
4. **injected.js** calls `currentXhr.abort()` which triggers `onabort` handler
5. **onabort handler** rejects promise with AbortError
6. **catch block** in downloadVideoInPage catches AbortError
7. **catch block** sends `{ status: 'aborted' }` message to content.js
8. **content.js** receives completion signal with abort status
9. **content.js** responds to background.js with `{ success: true, aborted: true }`
10. **background.js** receives response with `aborted: true`
11. **background.js** adds downloadId to `stoppedDownloadIds`
12. **delayed marking timeout** (5 seconds later) checks `stoppedDownloadIds.has(downloadId)` - returns true!
13. **Delayed marking** returns early and does NOT mark video as downloaded
14. **Video is correctly NOT marked as downloaded** ✅

## Testing Verification

To verify the fix:

1. Start auto-download or manual download queue
2. Wait for a video to start downloading (see progress updates)
3. Click "Stop Download" button while download is in progress (e.g., at 50-80%)
4. Check console logs:
   - Should see `"🛑 检测到下载被中止，添加到停止列表"`
   - Should see `"🛑 检测到下载被用户停止，取消延迟标记"` after 5 seconds
5. Check database:
   - Video should NOT be marked as "已下载"
   - Can re-download the same video later

## Files Modified

1. **content.js**: 
   - Modified `downloadVideoInPage` handler
   - Added Promise-based wait for completion signal
   - Added abort status check

2. **injected.js**:
   - Modified error handling in `downloadVideoInPage`
   - Added downloadComplete signal sending
   - Sends status for success/abort/error cases

3. **background.js**:
   - Modified response handling after content.js responds
   - Added abort flag check
   - Adds downloadId to stoppedDownloadIds when aborted

## Edge Cases Handled

1. **Network timeout**: 30-second timeout in content.js prevents hanging
2. **Abort before download starts**: AbortError caught before XHR send
3. **Multiple aborts**: Same downloadId can appear multiple times (no duplicate key issue)
4. **Abort during retry**: interruptibleSleep checks shouldStopFetching flag
5. **Stop all downloads**: Works with existing stopDownload handler

## Backwards Compatibility

- Non-aborted downloads work exactly as before
- Delayed marking timing unchanged (5 seconds)
- No changes to API or data structures (except response.aborted field)
- Gracefully handles missing completion signal (30-second timeout)
