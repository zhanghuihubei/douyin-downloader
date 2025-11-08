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
    
    // 转发给injected script下载（它在真正的页面上下文，没有CORS限制）
    window.postMessage({
      type: 'TO_DOUYIN_PAGE',
      action: 'downloadVideo',
      videoUrl: request.videoUrl,
      filename: request.filename
    }, '*');
    
    // 立即返回成功（实际下载由injected script处理）
    sendResponse({ success: true, downloadId: 'injected-' + Date.now() });
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
