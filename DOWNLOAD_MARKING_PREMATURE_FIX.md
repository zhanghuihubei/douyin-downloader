# Download Marking Premature Fix - 下载中断时错误标记问题修复

## 问题描述

当用户在下载进行中点击"停止下载"时，系统仍然会在 5 秒后标记视频为"已下载"，即使文件并没有实际保存。这导致：
- 视频被错误地标记为"已下载"
- 用户无法重新下载该视频（系统认为已下载过）
- 用户丢失了视频

## 根本原因

### 问题分析

在 `background.js` 的 `downloadVideo` 函数中，当 content script 成功响应后：

```javascript
if (response && response.success) {
  // ... 设置延迟标记 ...
  const markDownloadTimeout = setTimeout(async () => {
    // 5秒后执行标记
    await DouyinDB.markVideoAsDownloaded(videoData.awemeId, filename_final);
  }, 5000);
  
  // ❌ 问题：立即删除 downloadId
  inFlightDownloads.delete(downloadId);  // 第791行
}
```

**关键问题**：`inFlightDownloads.delete(downloadId)` 在 content script 成功响应后立即被执行。

### 导致的后果

1. **消息链中断**：当用户点击"停止下载"时：
   - `stopDownload` 处理器尝试获取所有待中断的 downloadIds
   - `const downloadIds = Array.from(inFlightDownloads.keys())` 返回空数组
   - 原因：downloadId 已经被删除了

2. **无法中止延迟标记**：
   - `markTimeout` 会在 5 秒后执行
   - 即使 XHR 被中断，`markTimeout` 仍然会标记视频为"已下载"
   - 结果：中断的下载仍被错误标记

## 修复方案

### 核心改变

**不在 content script 成功响应后立即删除 downloadId**

而是只在以下情况才删除：

1. **延迟标记被中止**（stopDownload 为 true）
2. **延迟标记成功完成**（markVideoAsDownloaded 成功）
3. **延迟标记发生错误**（异常处理）

### 具体修改

#### 1. 在 setTimeout 回调中处理删除

```javascript
const markDownloadTimeout = setTimeout(async () => {
  try {
    // 检查是否已被中断
    if (stopDownload) {
      console.log('🛑 检测到停止标志，取消延迟标记:', videoData.title);
      // 新增：在中止时删除
      inFlightDownloads.delete(downloadId);
      return;
    }
    
    const filename_final = `...`;
    await DouyinDB.markVideoAsDownloaded(videoData.awemeId, filename_final);
    console.log('✅ 延迟标记视频为已下载:', videoData.title);
    // 新增：标记成功后删除
    inFlightDownloads.delete(downloadId);
    
    // 通知popup更新状态
    // ...
  } catch (error) {
    console.error('❌ 延迟标记下载失败:', error);
    // 新增：错误时也清理
    inFlightDownloads.delete(downloadId);
  }
}, 5000);
```

#### 2. 移除立即删除

```javascript
// ❌ 移除这一行：
// inFlightDownloads.delete(downloadId);

// 代替以注释说明意图：
// 不在这里删除！保持downloadId在inFlightDownloads中，直到延迟标记完成
// 这样当用户在下载进行中停止时，能够找到这个downloadId
return 'content-script-' + downloadId;
```

## 修复后的流程

### 场景 1：正常下载完成（5秒内）

```
1. Content script响应下载请求
2. downloadId 保持在 inFlightDownloads 中
3. 5秒延迟标记执行
4. 检查 stopDownload = false（未停止）
5. 执行 markVideoAsDownloaded
6. 从 inFlightDownloads 中删除 downloadId
✅ 视频正确标记为已下载
```

### 场景 2：用户在下载进行中停止

```
1. Content script响应下载请求
2. downloadId 保持在 inFlightDownloads 中
3. 用户点击"停止下载"
4. stopDownload处理器：
   - 获取 downloadIds = [downloadId_1, downloadId_2, ...]（非空）
   - 发送 abortDownload 消息到 content script
   - 清除 markTimeout（取消5秒延迟标记）
5. injected.js 接收到 downloadIds，中断 XHR
6. markTimeout 不会执行（已被 clearTimeout）
✅ 视频不会被标记为已下载
```

### 场景 3：用户停止，然后延迟标记尝试执行

```
1. stopDownload处理器执行：
   - clearTimeout(downloadInfo.markTimeout)
2. 5秒后，markTimeout 的回调尝试执行：
   - 但因为已经被clearTimeout，回调不会运行
✅ 完全阻止了错误的标记
```

## 关键改进

### 1. downloadId 的生命周期

| 阶段 | 状态 | 备注 |
|------|------|------|
| 下载开始 | 在 inFlightDownloads 中 | 添加时 |
| Content script 响应 | 仍在 inFlightDownloads 中 | 保持不删除（修复点） |
| 5秒延迟标记期间 | 仍在 inFlightDownloads 中 | 这样 stopDownload 能找到 |
| 用户停止下载 | 从 inFlightDownloads 删除 | 在 stopDownload 处理器中 |
| 标记完成 | 从 inFlightDownloads 删除 | 在 setTimeout 回调中 |

### 2. stopDownload 处理器的改进

现在能正确获取所有待中断的 downloadIds：

```javascript
// 获取所有正在进行的下载ID列表
const downloadIds = Array.from(inFlightDownloads.keys());
// 现在 downloadIds 不再是空数组！
```

### 3. 延迟标记的可靠取消

```javascript
for (const [downloadId, downloadInfo] of inFlightDownloads.entries()) {
  // 取消延迟标记的timeout
  if (downloadInfo.markTimeout) {
    clearTimeout(downloadInfo.markTimeout);
  }
}
```

## 测试验证

### 测试场景 1：正常下载
1. 开始下载一个视频
2. 等待 5+ 秒
3. 验证视频被标记为"已下载"
4. ✅ 通过

### 测试场景 2：中途停止下载
1. 开始下载一个视频
2. 在下载进行中（0%-100% 之间任何时刻）点击"停止下载"
3. 立即检查数据库
4. 验证视频**不被标记**为"已下载"
5. 再次下载同一视频，应该能重新下载
6. ✅ 通过

### 测试场景 3：停止后再查看
1. 开始下载一个视频
2. 点击"停止下载"
3. 等待 6+ 秒（超过原本的 5 秒延迟）
4. 验证视频**仍未被标记**为"已下载"
5. ✅ 通过

## 日志调试

修复后，当用户停止下载时，会看到以下日志：

```
🛑 Content script收到中断下载请求
🆔 下载IDs: [1762756854402.6172]  ← 现在不为空！
🔪 正在中断当前XMLHttpRequest (ID: 1762756854402.6172)...
✅ XMLHttpRequest已成功中断
⏰ 已取消下载ID 1762756854402.6172 的延迟标记
```

## 总结

这个修复确保了：
1. ✅ 中断的下载不会被错误标记为"已下载"
2. ✅ 正常完成的下载仍会在 5 秒后被标记
3. ✅ 所有停止操作都能成功清除延迟标记
4. ✅ downloadId 在需要的时候保持可用，用完后立即清理
