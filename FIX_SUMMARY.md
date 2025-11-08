# 修复下载中断和 null status 错误

## 问题描述

1. **停止下载功能不工作**：点击停止下载后，下载被中断但出现 "Download aborted" 错误
2. **下载功能本身有问题**：出现 "Cannot read properties of null (reading 'status')" 错误

## 根本原因

### 1. null status 错误
在 `injected.js` 的 `downloadVideoInPage` 函数中，`currentXhr.onload` 事件处理程序存在 bug：
```javascript
currentXhr.onload = function() {
  currentXhr = null;  // 先设置为 null
  if (currentXhr && currentXhr.status === 200) {  // 然后访问 currentXhr.status，但 currentXhr 已经是 null
    // ...
  }
};
```

### 2. 中断处理问题
- `onprogress` 事件处理程序使用随机检查中断信号（`Math.random() < 0.01`），导致中断不及时
- `onabort` 事件处理程序抛出的错误被传播，导致未捕获的异常
- catch 块没有正确处理 `AbortError`，而是重新抛出错误

## 修复方案

### 1. 修复 null status 错误
```javascript
currentXhr.onload = function() {
  // 保存状态信息后再清理currentXhr
  const status = currentXhr ? currentXhr.status : null;
  const response = currentXhr ? currentXhr.response : null;
  const contentType = currentXhr ? currentXhr.getResponseHeader('Content-Type') : null;
  const contentLength = currentXhr ? currentXhr.getResponseHeader('Content-Length') : null;
  
  currentXhr = null;
  
  if (status === 200 && response) {
    console.log('📄 Content-Type:', contentType);
    console.log('📄 Content-Length:', contentLength);
    resolve(response);
  } else {
    reject(new Error(`HTTP ${status}: 下载失败`));
  }
};
```

### 2. 改进中断处理
- 移除随机检查，每次 `onprogress` 都检查中断信号
- 在 `onabort` 中使用特殊的错误类型 `AbortError`
- 在 catch 块中正确处理 `AbortError`，不重新抛出

```javascript
currentXhr.onabort = function() {
  console.log('🛑 XMLHttpRequest被中断');
  currentXhr = null;
  // 使用特殊的错误类型来标识中断
  const abortError = new Error('Download aborted');
  abortError.name = 'AbortError';
  reject(abortError);
};

currentXhr.onprogress = function(e) {
  // 检查是否收到中断信号
  if (abortSignal === 'active') {
    console.log('🔍 检测到中断信号，准备中断下载...');
    if (currentXhr) {
      currentXhr.abort();
    }
    return; // 直接返回，避免继续处理进度
  }
  // ...
};

// catch 块
} catch (error) {
  if (error.name === 'AbortError' || error.message === 'Download aborted') {
    console.log('🛑 下载被用户中断');
    // 对于中断错误，不重新抛出，只是记录日志
    return;
  } else {
    console.error('❌ 页面上下文下载失败:', error);
    console.error('错误详情:', error.stack);
    throw error;
  }
}
```

### 3. 改进 abortDownload 消息处理
添加 try-catch 以避免中断时的异常：
```javascript
if (action === 'abortDownload') {
  console.log('🛑 Injected script收到中断下载请求');
  if (currentXhr) {
    try {
      currentXhr.abort();
      console.log('✅ XMLHttpRequest已中断');
    } catch (error) {
      console.warn('⚠️ 中断XMLHttpRequest时出错:', error.message);
    }
    currentXhr = null;
  } else {
    console.log('ℹ️ 没有正在进行的下载');
  }
}
```

### 4. 改进 background.js 错误处理
添加对用户停止下载错误的特殊处理：
```javascript
// 检查是否是用户停止下载的错误
if (error.message && error.message.includes('Download stopped by user')) {
  console.log('🛑 用户停止下载:', videoData.title);
  const stopError = new Error('Download stopped by user');
  stopError.name = 'AbortError';
  throw stopError;
}
```

## 测试建议

1. 测试正常下载功能
2. 测试下载过程中点击停止按钮
3. 测试多个视频下载时中途停止
4. 检查控制台是否还有未捕获的异常

## 相关文件

- `injected.js` - 主要修复文件
- `background.js` - 改进错误处理
- `content.js` - 无需修改
- `popup.js` - 无需修改