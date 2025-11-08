// 后台服务 - 处理下载任务和定时轮询

// 加载IndexedDB管理模块
importScripts('db.js');

let downloadQueue = [];
let isDownloading = false;
let stopDownload = false; // 停止下载标志
let downloadIdToVideo = new Map(); // downloadId -> video 映射
let config = {
  autoDownload: true,
  checkInterval: 3600000, // 1小时检查一次
  lastCheckTime: null,
  minDelay: 20000, // 最小延迟20秒
  maxDelay: 30000  // 最大延迟30秒
};

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // 初始化IndexedDB
    await DouyinDB.initDB();
    console.log('✅ 数据库初始化成功');
    
    // 从chrome.storage.local迁移旧数据
    await DouyinDB.migrateFromChromeStorage();
    
    // 加载配置
    await loadConfig();
    
    console.log('抖音下载器已安装，配置:', config);
  } catch (error) {
    console.error('❌ 初始化失败:', error);
  }
});

// 启动时恢复配置
chrome.runtime.onStartup.addListener(async () => {
  try {
    // 初始化IndexedDB
    await DouyinDB.initDB();
    
    // 加载配置
    await loadConfig();
    
    // 启动自动下载
    if (config.autoDownload) {
      startAutoDownload();
    }
  } catch (error) {
    console.error('❌ 启动失败:', error);
  }
});

// 保存配置
async function saveConfig() {
  try {
    // 验证config对象的完整性
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config object');
    }
    
    console.log('📝 准备保存配置:', {
      autoDownload: config.autoDownload,
      checkInterval: config.checkInterval,
      lastCheckTime: config.lastCheckTime,
      minDelay: config.minDelay,
      maxDelay: config.maxDelay
    });
    
    // 保存各个配置项到IndexedDB
    const results = await Promise.all([
      DouyinDB.saveConfig('autoDownload', config.autoDownload),
      DouyinDB.saveConfig('checkInterval', config.checkInterval),
      DouyinDB.saveConfig('lastCheckTime', config.lastCheckTime),
      DouyinDB.saveConfig('minDelay', config.minDelay),
      DouyinDB.saveConfig('maxDelay', config.maxDelay)
    ]);
    
    console.log('✅ 配置保存成功', results);
  } catch (error) {
    console.error('❌ 保存配置失败:', error);
    console.error('错误类型:', error.constructor.name);
    console.error('错误消息:', error.message);
    console.error('错误代码:', error.code);
    throw error;
  }
}

// 加载配置
async function loadConfig() {
  try {
    // 从IndexedDB加载配置
    const [
      autoDownload,
      checkInterval,
      lastCheckTime,
      minDelay,
      maxDelay
    ] = await Promise.all([
      DouyinDB.getConfig('autoDownload', true),
      DouyinDB.getConfig('checkInterval', 3600000),
      DouyinDB.getConfig('lastCheckTime', null),
      DouyinDB.getConfig('minDelay', 20000),
      DouyinDB.getConfig('maxDelay', 30000)
    ]);
    
    config = {
      autoDownload,
      checkInterval,
      lastCheckTime,
      minDelay,
      maxDelay
    };
    console.log('✅ 配置加载成功:', config);
  } catch (error) {
    console.error('❌ 加载配置失败:', error);
    // 使用默认配置
    config = {
      autoDownload: true,
      checkInterval: 3600000,
      lastCheckTime: null,
      minDelay: 20000,
      maxDelay: 30000
    };
  }
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('后台收到消息:', request.action, request);
  
  if (request.action === 'downloadVideo') {
    downloadVideo(request.data).then(result => {
      sendResponse({ success: true, result });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true; // 异步响应
  }
  
  if (request.action === 'addToQueue') {
    console.log('收到视频数据:', request.videos.length, '个视频');
    console.log('视频样例:', request.videos[0]);
    addToQueue(request.videos);
    console.log('当前队列长度:', downloadQueue.length);
    sendResponse({ success: true, queued: request.videos.length });
    return true;
  }
  
  if (request.action === 'getStatus') {
    console.log('📊 处理getStatus请求，当前状态:', {
      isDownloading,
      queueLength: downloadQueue.length,
      stopDownload
    });
    DouyinDB.getStats().then(stats => {
      const statusResponse = {
        success: true,
        status: {
          queueLength: downloadQueue.length,
          isDownloading,
          downloadedCount: stats.downloadedVideos,
          autoDownload: config.autoDownload,
          lastCheckTime: config.lastCheckTime,
          stopDownload,
          stats: stats
        }
      };
      console.log('📤 发送状态响应:', statusResponse.status);
      sendResponse(statusResponse);
    }).catch(error => {
      console.error('获取统计信息失败:', error);
      const errorResponse = {
        success: true,
        status: {
          queueLength: downloadQueue.length,
          isDownloading,
          downloadedCount: 0,
          autoDownload: config.autoDownload,
          lastCheckTime: config.lastCheckTime,
          stopDownload
        }
      };
      console.log('📤 发送错误状态响应:', errorResponse.status);
      sendResponse(errorResponse);
    });
    return true;
  }
  
  if (request.action === 'toggleAutoDownload') {
    console.log('🔄 处理toggleAutoDownload，当前配置:', config);
    console.log('🔄 切换前autoDownload:', config.autoDownload);
    
    config.autoDownload = !config.autoDownload;
    console.log('🔄 切换后autoDownload:', config.autoDownload);
    
    saveConfig().then(() => {
      console.log('✅ 配置保存成功');
      if (config.autoDownload) {
        startAutoDownload();
      } else {
        stopAutoDownload();
        // 如果正在下载，立即停止当前下载
        if (isDownloading) {
          console.log('🔄 切换到暂停状态，正在下载中，立即停止下载');
          stopDownload = true;
        }
      }
      sendResponse({ success: true, autoDownload: config.autoDownload });
    }).catch(error => {
      console.error('❌ 保存配置失败:', error);
      console.error('错误详情:', {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      // 恢复原状态
      config.autoDownload = !config.autoDownload;
      console.log('🔄 恢复autoDownload状态为:', config.autoDownload);
      sendResponse({ success: false, error: '保存配置失败: ' + error.message });
    });
    return true;
  }
  
  if (request.action === 'setCheckInterval') {
    config.checkInterval = request.interval;
    DouyinDB.saveConfig('checkInterval', config.checkInterval).then(() => {
      if (config.autoDownload) {
        stopAutoDownload();
        startAutoDownload();
      }
      sendResponse({ success: true });
    }).catch(error => {
      console.error('❌ 保存配置失败:', error);
      sendResponse({ success: false, error: '保存配置失败' });
    });
    return true;
  }
  
  if (request.action === 'followingListReceived') {
    console.log('收到关注列表:', request.users.length, '个用户');
    // 保存用户列表到数据库
    DouyinDB.saveUsers(request.users.map(u => ({
      userId: u.uid,
      nickname: u.nickname,
      avatar: u.avatar,
      enabled: true
    }))).then(() => {
      console.log('✅ 用户列表已保存到数据库');
      sendResponse({ success: true });
    }).catch(error => {
      console.error('❌ 保存用户列表失败:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  // ==================== 用户管理API ====================
  
  if (request.action === 'downloadBlob') {
    console.log('📥 收到blob下载请求:', request.filename);
    
    // 确保文件名以.mp4结尾
    let finalFilename = request.filename;
    if (!finalFilename.toLowerCase().endsWith('.mp4')) {
      console.warn('⚠️ 文件名没有.mp4扩展名，添加...');
      finalFilename += '.mp4';
    }
    
    console.log('📝 最终文件名:', finalFilename);
    console.log('🔗 Blob URL:', request.blobUrl.substring(0, 50) + '...');
    
    chrome.downloads.download({
      url: request.blobUrl,
      filename: `抖音视频/${finalFilename}`,
      saveAs: false,
      conflictAction: 'uniquify' // 如果文件存在，自动重命名
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('❌ Blob下载失败:', chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('✅ Blob下载已开始，ID:', downloadId);
        // 如果有video信息，记录映射
        if (request.video) {
          downloadIdToVideo.set(downloadId, request.video);
        }
        sendResponse({ success: true, downloadId: downloadId });
      }
    });
    return true; // 异步响应
  }
  
  // ==================== 用户管理API ====================
  
  if (request.action === 'getAllUsers') {
    DouyinDB.getAllUsers(request.filter || {}).then(users => {
      sendResponse({ success: true, users });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'toggleUser') {
    DouyinDB.toggleUserEnabled(request.userId).then(user => {
      sendResponse({ success: true, user });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'deleteUser') {
    DouyinDB.deleteUser(request.userId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'getUserVideos') {
    DouyinDB.getVideosByUser(request.userId, request.filter || {}).then(videos => {
      sendResponse({ success: true, videos });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'getStats') {
    DouyinDB.getStats().then(stats => {
      sendResponse({ success: true, stats });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'getAllDownloadedVideos') {
    DouyinDB.getAllDownloadedVideos().then(videos => {
      sendResponse({ success: true, videos });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'deleteVideo') {
    DouyinDB.deleteVideo(request.awemeId).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'stopDownload') {
    console.log('🛑 收到停止下载指令，当前状态:', {
      isDownloading,
      queueLength: downloadQueue.length
    });
    stopDownload = true;
    // 立即设置isDownloading为false，确保UI状态更新
    isDownloading = false;
    console.log('✅ 已设置停止标志并重置下载状态');
    sendResponse({ success: true });
    return true;
  }
});

// 添加视频到下载队列
async function addToQueue(videos) {
  console.log('=== 添加视频到队列 ===');
  console.log('收到', videos.length, '个视频');
  let addedCount = 0;
  let duplicateCount = 0;
  
  // 先保存所有视频到数据库（保留已下载视频的状态）
  try {
    await DouyinDB.saveVideos(videos.map(v => ({
      ...v,
      downloaded: false  // 新视频标记为未下载
    })), true);  // ✅ preserveDownloadStatus = true，保护已下载的视频
    console.log('✅ 视频信息已保存到数据库（保留已下载状态）');
  } catch (error) {
    console.error('❌ 保存视频信息失败:', error);
  }
  
  for (const video of videos) {
    // 检查是否已下载或已在队列中
    const isDownloaded = await DouyinDB.isVideoDownloaded(video.awemeId);
    if (isDownloaded) {
      console.log('跳过已下载:', video.title);
      duplicateCount++;
    } else if (downloadQueue.some(v => v.awemeId === video.awemeId)) {
      console.log('跳过队列中已存在:', video.title);
      duplicateCount++;
    } else {
      downloadQueue.push(video);
      addedCount++;
      console.log('✅ 添加视频:', video.title);
    }
  }
  
  console.log('新增', addedCount, '个视频，跳过', duplicateCount, '个重复，队列总长度:', downloadQueue.length);
  
  // 如果没在下载，开始下载
  if (!isDownloading && downloadQueue.length > 0) {
    console.log('开始处理下载队列...');
    processQueue();
  } else if (isDownloading) {
    console.log('已在下载中，等待队列处理...');
  } else {
    console.log('队列为空，无需下载');
  }
}

// 处理下载队列
async function processQueue() {
  if (isDownloading || downloadQueue.length === 0) {
    return;
  }
  
  console.log('=== 开始处理下载队列 ===');
  console.log('📦 队列中有', downloadQueue.length, '个视频待下载');
  console.log('⏱️ 限流配置: 每个视频间隔', config.minDelay/1000, '-', config.maxDelay/1000, '秒');
  isDownloading = true;
  
  while (downloadQueue.length > 0) {
    // 检查是否需要停止下载
    if (stopDownload) {
      console.log('🛑 收到停止下载指令，终止队列处理');
      stopDownload = false; // 重置标志
      break;
    }
    
    const video = downloadQueue.shift();
    console.log('正在下载:', video.title, '剩余:', downloadQueue.length);
    try {
      const downloadId = await downloadVideo(video);
      console.log('✅ 下载已开始，ID:', downloadId);
      // 记录downloadId与video的映射，等待完成事件
      downloadIdToVideo.set(downloadId, video);
    } catch (error) {
      console.error('❌ 下载失败:', video.title, error);
    }
    
    // 如果还有待下载的视频，等待随机时间（20-30秒）
    if (downloadQueue.length > 0) {
      const delay = getRandomDelay(config.minDelay, config.maxDelay);
      console.log('⏱️ 等待', (delay/1000).toFixed(1), '秒后继续下载...');
      await sleep(delay);
    }
  }
  
  console.log('=== 下载队列处理完成 ===');
  isDownloading = false;
}

// 下载单个视频
async function downloadVideo(videoData) {
  console.log('=== 下载视频 ===');
  console.log('标题:', videoData.title);
  console.log('作者:', videoData.author);
  console.log('视频URL:', videoData.videoUrl);
  
  const { videoUrl, title, author, awemeId } = videoData;
  
  if (!videoUrl) {
    throw new Error('视频URL为空');
  }
  
  // 清理文件名中的非法字符
  const sanitizedTitle = sanitizeFilename(title);
  const sanitizedAuthor = sanitizeFilename(author);
  const filename = `${sanitizedAuthor}_${sanitizedTitle}_${awemeId}.mp4`;
  
  console.log('文件名:', filename);
  
  // 策略：委托给content script下载，因为它运行在页面上下文中，有完整的cookies和会话
  try {
    console.log('📨 委托content script下载视频...');
    
    // 找到抖音标签页
    const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
    if (tabs.length === 0) {
      console.warn('⚠️ 没有找到抖音标签页，使用直接下载');
      return await downloadViaChrome(videoUrl, filename);
    }
    
    // 使用第一个抖音标签页
    const tab = tabs[0];
    console.log('使用标签页:', tab.id, tab.title);
    
    // 发送下载请求到content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'downloadVideoInPage',
      videoUrl: videoUrl,
      filename: filename
    });
    
    if (response && response.success) {
      console.log('✅ Content script下载成功');
      // 对于content script下载，立即标记为已下载，因为它直接处理
      const filename_final = `${sanitizeFilename(videoData.author)}_${sanitizeFilename(videoData.title)}_${videoData.awemeId}.mp4`;
      await DouyinDB.markVideoAsDownloaded(videoData.awemeId, filename_final);
      // 通知popup更新状态
      chrome.runtime.sendMessage({
        action: 'downloadProgress',
        downloaded: videoData.title,
        remaining: downloadQueue.length
      }).catch(() => {});
      return 'content-script-' + Date.now(); // 返回虚拟downloadId
    } else {
      console.warn('⚠️ Content script下载失败，使用备用方案');
      return await downloadViaChrome(videoUrl, filename);
    }
  } catch (error) {
    console.error('❌ 委托下载失败:', error);
    // 如果委托失败，使用chrome.downloads直接下载
    return await downloadViaChrome(videoUrl, filename);
  }
}

// 直接使用Chrome下载API（备用方案）
async function downloadViaChrome(videoUrl, filename) {
  console.log('使用Chrome Downloads API直接下载...');
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: videoUrl,
      filename: `抖音视频/${filename}`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载API错误:', chrome.runtime.lastError.message);
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log('✅ 下载已开始，ID:', downloadId);
        resolve(downloadId);
      }
    });
  });
}

// 清理文件名
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '') // 移除非法字符
    .replace(/\s+/g, '_') // 空格替换为下划线
    .substring(0, 50); // 限制长度
}

// 休眠函数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 获取随机延迟时间
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 监听下载完成事件
chrome.downloads.onChanged.addListener((delta) => {
  const downloadId = delta.id;
  
  // 检查是否有对应的video
  if (downloadIdToVideo.has(downloadId)) {
    const video = downloadIdToVideo.get(downloadId);
    
    if (delta.state && delta.state.current === 'complete') {
      console.log('📦 下载完成，ID:', downloadId, '视频:', video.title);
      // 下载成功，标记为已下载
      const filename = `${sanitizeFilename(video.author)}_${sanitizeFilename(video.title)}_${video.awemeId}.mp4`;
      DouyinDB.markVideoAsDownloaded(video.awemeId, filename).then(() => {
        console.log('✅ 已标记视频为已下载:', video.title);
        // 通知popup更新状态
        chrome.runtime.sendMessage({
          action: 'downloadProgress',
          downloaded: video.title,
          remaining: downloadQueue.length
        }).catch(() => {});
      }).catch(error => {
        console.error('❌ 标记下载失败:', error);
      });
      
      // 清理映射
      downloadIdToVideo.delete(downloadId);
      
    } else if (delta.state && delta.state.current === 'interrupted') {
      console.error('❌ 下载中断，ID:', downloadId, '视频:', video.title);
      // 下载失败，不标记为已下载
      // 可以选择重新加入队列，但这里先不处理
      
      // 清理映射
      downloadIdToVideo.delete(downloadId);
    }
  }
  
  // 记录下载信息（无论是否有映射）
  if (delta.state && delta.state.current === 'complete') {
    console.log('📦 下载完成，ID:', downloadId);
    chrome.downloads.search({ id: downloadId }, (results) => {
      if (results && results.length > 0) {
        const download = results[0];
        console.log('✅ 文件已保存:', download.filename);
        console.log('📊 文件大小:', (download.fileSize / 1024 / 1024).toFixed(2), 'MB');
      }
    });
  } else if (delta.state && delta.state.current === 'interrupted') {
    console.error('❌ 下载中断，ID:', downloadId);
    chrome.downloads.search({ id: downloadId }, (results) => {
      if (results && results.length > 0) {
        const download = results[0];
        console.error('中断原因:', download.error);
        console.error('文件:', download.filename);
      }
    });
  }
});

// 自动下载相关
let autoDownloadInterval = null;

function startAutoDownload() {
  if (autoDownloadInterval) {
    return;
  }
  console.log('启动自动下载，检查间隔:', config.checkInterval, 'ms');
  
  // 立即执行一次
  checkAndDownloadNew();
  
  // 设置定时器
  autoDownloadInterval = setInterval(() => {
    checkAndDownloadNew();
  }, config.checkInterval);
}

function stopAutoDownload() {
  if (autoDownloadInterval) {
    clearInterval(autoDownloadInterval);
    autoDownloadInterval = null;
    console.log('停止自动下载');
  }
}

async function checkAndDownloadNew() {
  console.log('开始检查新视频...');
  config.lastCheckTime = Date.now();
  
  try {
    // 保存更新后的检查时间
    await DouyinDB.saveConfig('lastCheckTime', config.lastCheckTime);
    console.log('✅ 检查时间已保存');
  } catch (error) {
    console.error('❌ 保存检查时间失败:', error);
    // 继续执行，即使保存失败
  }
  
  // 通知所有抖音标签页开始扫描
  const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { action: 'scanFollowing' }).catch(() => {});
  }
}
