// Content Script - 注入到抖音页面，获取用户数据

console.log('抖音下载器 Content Script 已加载');

// 注入脚本到页面上下文以访问页面变量
function injectScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
}

// 页面加载完成后注入
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectScript);
} else {
  injectScript();
}

// 监听来自injected script的消息
window.addEventListener('message', async (event) => {
  if (event.source !== window) return;
  if (!event.data.type || event.data.type !== 'FROM_DOUYIN_PAGE') return;
  
  const { action, data } = event.data;
  
  if (action === 'followingList') {
    console.log('收到关注列表:', data.length, '个用户');
    // 发送到background script处理
    chrome.runtime.sendMessage({
      action: 'followingListReceived',
      users: data
    });
    
    // 开始获取每个用户的视频
    console.log('开始获取用户视频，共', data.length, '个用户');
    for (let i = 0; i < data.length; i++) {
      const user = data[i];
      const userId = user.sec_uid || user.uid; // 优先使用sec_uid
      console.log(`[${i+1}/${data.length}] 请求用户视频:`, user.nickname, userId);
      
      window.postMessage({
        type: 'TO_DOUYIN_PAGE',
        action: 'getUserVideos',
        userId: userId
      }, '*');
      
      // 随机等待3-5秒避免请求过快
      if (i < data.length - 1) {
        const delay = getRandomDelay(3000, 5000);
        console.log(`⏱️ 等待 ${(delay/1000).toFixed(1)} 秒后继续...`);
        await sleep(delay);
      }
    }
  }
  
  if (action === 'userVideos') {
    console.log('收到用户视频:', data.author, data.videos.length, '个视频');
    console.log('视频详情:', data.videos);
    // 发送到background script加入下载队列
    const response = await chrome.runtime.sendMessage({
      action: 'addToQueue',
      videos: data.videos
    });
    console.log('发送到后台的响应:', response);
  }
  
  if (action === 'error') {
    console.error('页面脚本错误:', data);
  }
});

// 监听来自background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'scanFollowing') {
    console.log('开始扫描关注列表...');
    // 通知injected script开始扫描
    window.postMessage({
      type: 'TO_DOUYIN_PAGE',
      action: 'getFollowingList'
    }, '*');
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'downloadVideoInPage') {
    console.log('📥 Content script收到下载请求:', request.filename);
    console.log('🔀 转发给injected script（真正的页面上下文）...');
    console.log('🚦 中断信号状态:', request.abortSignal || 'none');
    console.log('🆔 下载ID:', request.downloadId || 'none');
    
    const downloadId = request.downloadId || Date.now();
    
    // 等待injected script的下载完成或中止
    const downloadPromise = new Promise((resolveDownload) => {
      // 设置一个一次性的消息监听器来接收下载结果
      const handleDownloadResult = (event) => {
        if (event.source !== window) return;
        if (!event.data.type || event.data.type !== 'FROM_DOUYIN_PAGE') return;
        
        // 检查是否是这个下载的完成事件
        if (event.data.action === 'downloadComplete' && event.data.downloadId === downloadId) {
          console.log('📤 收到下载完成信号:', event.data.downloadId, '状态:', event.data.status);
          window.removeEventListener('message', handleDownloadResult);
          clearTimeout(timeoutId); // 清除超时器
          resolveDownload(event.data);
        }
      };
      
      window.addEventListener('message', handleDownloadResult);
      
      // 设置超时（30秒），以防消息丢失
      const timeoutId = setTimeout(() => {
        window.removeEventListener('message', handleDownloadResult);
        console.warn('⏱️ 下载消息等待超时，使用默认成功响应');
        resolveDownload({ status: 'timeout', downloadId: downloadId });
      }, 30000);
      
      // 转发给injected script下载（它在真正的页面上下文，没有CORS限制）
      window.postMessage({
        type: 'TO_DOUYIN_PAGE',
        action: 'downloadVideo',
        videoUrl: request.videoUrl,
        filename: request.filename,
        abortSignal: request.abortSignal || 'inactive',
        downloadId: downloadId
      }, '*');
    });
    
    // 异步处理下载结果并返回
    downloadPromise.then((result) => {
      console.log('📤 Content script返回下载结果:', result);
      
      // 如果是中止状态，返回不同的信息
      if (result.status === 'aborted') {
        const response = { 
          success: true, 
          downloadId: 'injected-' + downloadId,
          aborted: true
        };
        console.log('📤 发送中止响应给background:', response);
        sendResponse(response);
      } else {
        const response = { 
          success: true, 
          downloadId: 'injected-' + downloadId
        };
        console.log('📤 发送成功响应给background:', response);
        sendResponse(response);
      }
    }).catch((error) => {
      console.error('❌ Content script等待下载结果时出错:', error);
      const response = { 
        success: false, 
        error: error.message,
        downloadId: 'injected-' + downloadId
      };
      console.log('📤 发送错误响应给background:', response);
      sendResponse(response);
    });
    
    return true; // 异步响应
  }
  
  if (request.action === 'abortDownload') {
    console.log('📥 Content script收到中断下载请求');
    console.log('⏰ 时间戳:', request.timestamp || 'none');
    console.log('🆔 下载IDs:', request.downloadIds || []);
    
    // 转发给injected script中断下载（添加时间戳确保消息新鲜度，包含所有要中断的ID）
    window.postMessage({
      type: 'TO_DOUYIN_PAGE',
      action: 'abortDownload',
      timestamp: request.timestamp || Date.now(),
      downloadIds: request.downloadIds || []
    }, '*');
    
    // 给injected script一点时间处理中断
    setTimeout(() => {
      sendResponse({ success: true });
    }, 100);
    return true;
  }
  
  return true;
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取随机延迟时间
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
