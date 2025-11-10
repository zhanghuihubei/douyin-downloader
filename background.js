// 后台服务 - 处理下载任务和定时轮询

// 加载IndexedDB管理模块
importScripts('db.js');

// 调试：检查 DouyinDB 对象
console.log('🔍 DouyinDB 对象已加载:', typeof DouyinDB);
console.log('🔍 DouyinDB.saveConfig:', typeof DouyinDB.saveConfig);

let downloadQueue = [];
let isDownloading = false;
let stopDownload = false; // 停止下载标志
let currentDownloadController = null; // 当前下载的控制器
let downloadIdToVideo = new Map(); // downloadId -> video 映射
let inFlightDownloads = new Map(); // 跟踪正在进行的下载 downloadId -> {controller, startTime}
let stoppedDownloadIds = new Set(); // 存储被用户停止的下载ID
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
async function saveBackgroundConfig() {
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
    
    // 分别保存每个配置项到IndexedDB
    // 验证并保存 autoDownload
    if (config.autoDownload !== undefined) {
      console.log('💾 保存 autoDownload:', config.autoDownload);
      await DouyinDB.saveConfig('autoDownload', config.autoDownload);
    }
    
    // 验证并保存 checkInterval
    if (config.checkInterval !== undefined) {
      console.log('💾 保存 checkInterval:', config.checkInterval);
      await DouyinDB.saveConfig('checkInterval', config.checkInterval);
    }
    
    // 验证并保存 lastCheckTime
    if (config.lastCheckTime !== undefined) {
      console.log('💾 保存 lastCheckTime:', config.lastCheckTime);
      await DouyinDB.saveConfig('lastCheckTime', config.lastCheckTime);
    }
    
    // 验证并保存 minDelay
    if (config.minDelay !== undefined) {
      console.log('💾 保存 minDelay:', config.minDelay);
      await DouyinDB.saveConfig('minDelay', config.minDelay);
    }
    
    // 验证并保存 maxDelay
    if (config.maxDelay !== undefined) {
      console.log('💾 保存 maxDelay:', config.maxDelay);
      await DouyinDB.saveConfig('maxDelay', config.maxDelay);
    }
    
    console.log('✅ 配置保存成功');
  } catch (error) {
    console.error('❌ 保存配置失败:', error);
    console.error('错误详情:', {
      name: error.name,
      message: error.message,
      code: error.code,
      stack: error.stack
    });
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
    
    saveBackgroundConfig().then(async () => {
      console.log('✅ 配置保存成功');
      if (config.autoDownload) {
        startAutoDownload();
      } else {
        stopAutoDownload();
        // 如果正在下载，立即停止当前下载
        if (isDownloading) {
          console.log('🔄 切换到暂停状态，正在下载中，立即停止下载');
          stopDownload = true;

          // 中断所有正在进行的下载控制器
          // 通知所有抖音标签页中断下载
          const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
          const downloadIds = Array.from(inFlightDownloads.keys());
          console.log(`🆔 暂停时需要中断的下载ID列表: ${downloadIds.join(', ')}`);

          for (const tab of tabs) {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                action: 'abortDownload',
                timestamp: Date.now(),
                downloadIds: downloadIds
              });
            } catch (error) {
              console.log('标签页', tab.id, '发送中断消息失败:', error.message);
            }
          }

          console.log(`🛑 暂停时中断所有 ${inFlightDownloads.size} 个正在进行的下载...`);
          for (const [downloadId, downloadInfo] of inFlightDownloads.entries()) {
            // 记录被停止的下载ID
            stoppedDownloadIds.add(downloadId);
            console.log(`📝 暂停时记录被停止的下载ID: ${downloadId}`);
            
            try {
              // 取消延迟标记的timeout
              if (downloadInfo.markTimeout) {
                clearTimeout(downloadInfo.markTimeout);
                console.log(`⏰ 暂停时已取消下载ID ${downloadId} 的延迟标记`);
              }
              
              if (downloadInfo.controller) {
                downloadInfo.controller.abort();
                console.log(`✅ 下载ID ${downloadId} 控制器已中断`);
              }
            } catch (error) {
              console.log(`⚠️ 中断下载ID ${downloadId} 时出错:`, error.message);
            }
          }
          inFlightDownloads.clear();

          // 中断当前正在进行的下载
          if (currentDownloadController) {
            console.log('🛑 暂停时中断当前下载...');
            currentDownloadController.abort();
            currentDownloadController = null;
          }

          isDownloading = false;

          // 延迟重置stopDownload标志
          setTimeout(() => {
            stopDownload = false;
            console.log('🔄 暂停自动下载时已重置停止下载标志');
          }, 1000);
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
    (async () => {
      console.log('🛑 收到停止下载指令，当前状态:', {
        isDownloading,
        queueLength: downloadQueue.length,
        inFlightCount: inFlightDownloads.size,
        hasController: !!currentDownloadController
      });
      
      // 先记录当前状态，用于响应
      const wasDownloading = isDownloading;
      const clearedCount = downloadQueue.length;
      
      // 立即设置停止标志（这是最重要的）
      stopDownload = true;
      console.log('🚦 已设置停止下载标志为true');
      
      // 清空下载队列
      downloadQueue = [];
      console.log(`🗑️ 已清空下载队列，移除了 ${clearedCount} 个待下载视频`);
      
      // 立即通知所有抖音标签页中断下载（并行执行以提高速度）
      const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
      console.log(`📢 通知 ${tabs.length} 个抖音标签页中断下载`);

      // 获取所有正在进行的下载ID列表
      const downloadIds = Array.from(inFlightDownloads.keys());
      console.log(`🆔 需要中断的下载ID列表: ${downloadIds.join(', ')}`);

      const abortPromises = tabs.map(async (tab) => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'abortDownload',
            timestamp: Date.now(), // 添加时间戳确保消息新鲜度
            downloadIds: downloadIds // 包含所有需要中断的下载ID
          });
          console.log(`✅ 标签页 ${tab.id} 中断消息发送成功`);
        } catch (error) {
          console.log(`❌ 标签页 ${tab.id} 发送中断消息失败:`, error.message);
        }
      });

      // 等待所有消息发送完成
      await Promise.allSettled(abortPromises);
      console.log('📢 所有标签页中断消息发送完成');

      // 记录所有被停止的下载ID，并中断所有正在进行的下载控制器和取消延迟标记
      console.log(`🛑 中断所有 ${inFlightDownloads.size} 个正在进行的下载...`);
      for (const [downloadId, downloadInfo] of inFlightDownloads.entries()) {
        // 记录被停止的下载ID
        stoppedDownloadIds.add(downloadId);
        console.log(`📝 记录被停止的下载ID: ${downloadId}`);
        
        try {
          // 取消延迟标记的timeout
          if (downloadInfo.markTimeout) {
            clearTimeout(downloadInfo.markTimeout);
            console.log(`⏰ 已取消下载ID ${downloadId} 的延迟标记`);
          } else {
            console.log(`⚠️ 下载ID ${downloadId} 没有markTimeout`);
          }
          
          // 中断下载控制器
          if (downloadInfo.controller) {
            downloadInfo.controller.abort();
            console.log(`✅ 下载ID ${downloadId} 控制器已中断`);
          } else {
            console.log(`⚠️ 下载ID ${downloadId} 没有控制器`);
          }
        } catch (error) {
          console.log(`⚠️ 中断下载ID ${downloadId} 时出错:`, error.message);
        }
      }
      inFlightDownloads.clear();
      console.log('🗑️ 已清空所有正在进行的下载跟踪');
      
      // 如果有当前正在进行的下载，立即中断它
      if (currentDownloadController) {
        console.log('🛑 立即中断当前下载控制器...');
        try {
          currentDownloadController.abort();
          console.log('✅ 下载控制器已中断');
        } catch (error) {
          console.log('❌ 中断下载控制器时出错:', error.message);
        }
        currentDownloadController = null;
      }

      // 立即设置isDownloading为false
      isDownloading = false;
      console.log('🔄 已设置isDownloading为false');

      // 延迟重置stopDownload标志，给UI足够时间更新
      setTimeout(() => {
        stopDownload = false;
        console.log('🔄 已重置停止下载标志为false');
      }, 2000); // 增加到2秒，确保UI有足够时间响应

      console.log('✅ 停止下载操作完成');
      sendResponse({
        success: true,
        clearedCount,
        wasDownloading,
        inFlightCount: inFlightDownloads.size,
        message: wasDownloading 
          ? `已停止下载并清空队列，移除了 ${clearedCount} 个待下载视频`
          : `已清空队列，移除了 ${clearedCount} 个待下载视频`
      });
    })();
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
      // 不在这里重置stopDownload，让停止处理函数统一管理
      break;
    }
    
    const video = downloadQueue.shift();
    console.log('正在下载:', video.title, '剩余:', downloadQueue.length);
    
    // 在下载前再次检查停止标志
    if (stopDownload) {
      console.log('🛑 下载前检查到停止指令，取消:', video.title);
      break;
    }
    
    try {
      const downloadId = await downloadVideo(video);
      console.log('✅ 下载已开始，ID:', downloadId);
      // 记录downloadId与video的映射，等待完成事件
      downloadIdToVideo.set(downloadId, video);
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('🛑 下载被用户中断:', video.title);
        // 如果是中断错误，直接退出循环
        break;
      } else {
        console.error('❌ 下载失败:', video.title, error);
      }
    }
    
    // 再次检查是否需要停止下载（在等待下一个下载之前）
    if (stopDownload) {
      console.log('🛑 收到停止下载指令，终止队列处理');
      // 不在这里重置stopDownload，让停止处理函数统一管理
      break;
    }
    
    // 如果还有待下载的视频，等待随机时间（20-30秒）
    if (downloadQueue.length > 0) {
      const delay = getRandomDelay(config.minDelay, config.maxDelay);
      console.log('⏱️ 等待', (delay/1000).toFixed(1), '秒后继续下载...');
      
      // 在等待期间也要检查停止信号（使用可中断的等待）
      const waitStart = Date.now();
      while (Date.now() - waitStart < delay) {
        if (stopDownload) {
          console.log('🛑 等待期间收到停止指令，中断等待');
          break;
        }
        await sleep(100); // 每100ms检查一次
      }
      
      // 如果在等待期间收到停止指令，退出循环
      if (stopDownload) {
        console.log('🛑 等待期间检测到停止指令，终止队列处理');
        break;
      }
    }
  }
  
  if (stopDownload) {
    console.log('🛑 下载队列被用户中断');
  } else {
    console.log('✅ 下载队列自然完成');
  }
  
  console.log('=== 下载队列处理完成 ===');
  isDownloading = false;
  currentDownloadController = null;
}

// 下载单个视频
async function downloadVideo(videoData) {
  console.log('=== 下载视频 ===');
  console.log('标题:', videoData.title);
  console.log('作者:', videoData.author);
  console.log('视频URL:', videoData.videoUrl);
  
  // 在开始下载前检查是否需要停止（提前检查）
  if (stopDownload) {
    console.log('🛑 检测到停止标志，取消下载:', videoData.title);
    // 创建一个AbortError，这样上层能正确识别为中断
    const error = new Error('Download stopped by user');
    error.name = 'AbortError';
    throw error;
  }
  
  // 创建新的下载控制器
  currentDownloadController = new AbortController();
  const downloadId = Date.now() + Math.random(); // 唯一的下载ID
  
  // 在inFlightDownloads中跟踪这次下载
  inFlightDownloads.set(downloadId, {
    controller: currentDownloadController,
    startTime: Date.now(),
    video: videoData
  });
  console.log(`📍 开始跟踪下载ID ${downloadId}，当前进行中的下载: ${inFlightDownloads.size}`);
  
  // 再次检查停止标志（防止在创建控制器期间收到停止指令）
  if (stopDownload) {
    console.log('🛑 控制器创建后检测到停止标志，立即中断:', videoData.title);
    currentDownloadController.abort();
    inFlightDownloads.delete(downloadId);
    currentDownloadController = null;
    const error = new Error('Download stopped by user');
    error.name = 'AbortError';
    throw error;
  }
  
  const { videoUrl, title, author, awemeId } = videoData;
  
  if (!videoUrl) {
    inFlightDownloads.delete(downloadId);
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
      return await downloadViaChrome(videoUrl, filename, currentDownloadController, downloadId);
    }
    
    // 使用第一个抖音标签页
    const tab = tabs[0];
    console.log('使用标签页:', tab.id, tab.title);
    
    // 发送下载请求到content script（包含中断信号和控制器引用）
    // 直接传递AbortController的aborted状态
    console.log('🔍 发送下载请求到content script，downloadId:', downloadId);
    
    // 立即创建延迟标记的timeout，这样stopDownload可以随时取消它
    const markDownloadTimeout = setTimeout(async () => {
      console.log('⏰ 延迟标记回调触发，downloadId:', downloadId);
      console.log('⏰ stoppedDownloadIds包含:', Array.from(stoppedDownloadIds));
      try {
        // 检查这个下载是否被用户停止了（防止在延迟期间收到停止指令）
        if (stoppedDownloadIds.has(downloadId)) {
          console.log('🛑 检测到下载被用户停止，取消延迟标记:', videoData.title);
          // 从停止列表中移除并清理
          stoppedDownloadIds.delete(downloadId);
          inFlightDownloads.delete(downloadId);
          return;
        }

        const filename_final = `${sanitizeFilename(videoData.author)}_${sanitizeFilename(videoData.title)}_${videoData.awemeId}.mp4`;
        await DouyinDB.markVideoAsDownloaded(videoData.awemeId, filename_final);
        console.log('✅ 延迟标记视频为已下载:', videoData.title);
        // 标记完成后从inFlightDownloads中删除
        inFlightDownloads.delete(downloadId);
        // 通知popup更新状态
        chrome.runtime.sendMessage({
          action: 'downloadProgress',
          downloaded: videoData.title,
          remaining: downloadQueue.length
        }).catch(() => {});
      } catch (error) {
        console.error('❌ 延迟标记下载失败:', error);
        // 错误时也清理
        inFlightDownloads.delete(downloadId);
      }
    }, 5000); // 延迟5秒
    
    // 立即存储timeout ID，这样stopDownload可以找到它
    const downloadInfo = inFlightDownloads.get(downloadId);
    if (downloadInfo) {
      downloadInfo.markTimeout = markDownloadTimeout;
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'downloadVideoInPage',
      videoUrl: videoUrl,
      filename: filename,
      abortSignal: currentDownloadController.signal.aborted ? 'active' : 'inactive',
      downloadId: downloadId // 用于标识这次下载请求
    });
    
    console.log('🔍 收到content script响应:', response);
    
    if (response && response.success) {
      console.log('✅ Content script下载请求已发送');
      console.log('🔍 检查响应是否包含中止状态:', response);
      
      // 检查下载是否被中止
      if (response.aborted) {
        console.log('🛑 检测到下载被中止，添加到停止列表:', videoData.title);
        console.log('🛑 添加downloadId到stoppedDownloadIds:', downloadId);
        console.log('🛑 Content script返回的downloadId:', response.downloadId);
        
        stoppedDownloadIds.add(downloadId);
        console.log('🛑 stoppedDownloadIds现在包含:', Array.from(stoppedDownloadIds));
        
        // 取消延迟标记的timeout
        const downloadInfo = inFlightDownloads.get(downloadId);
        if (downloadInfo && downloadInfo.markTimeout) {
          clearTimeout(downloadInfo.markTimeout);
          console.log('⏰ 已取消下载ID', downloadId, '的延迟标记（因为被中止）');
        }
        
        inFlightDownloads.delete(downloadId);
        
        // 下载被中止，抛出错误让下载队列继续处理下一个
        const abortError = new Error('Download aborted by user');
        abortError.name = 'AbortError';
        throw abortError;
      }
      
      // 注意：延迟标记的timeout已经在发送消息之前创建了
      // 这里不需要再创建，避免重复执行
      
      // 不在这里删除！保持downloadId在inFlightDownloads中，直到延迟标记完成
      // 这样当用户在下载进行中停止时，能够找到这个downloadId
      return 'content-script-' + downloadId; // 返回虚拟downloadId
    } else {
      console.warn('⚠️ Content script下载失败，使用备用方案');
      return await downloadViaChrome(videoUrl, filename, currentDownloadController, downloadId);
    }
    } catch (error) {
      // 在清理前先获取下载信息，用于取消延迟标记
      const downloadInfo = inFlightDownloads.get(downloadId);
      
      inFlightDownloads.delete(downloadId);
      
      // 从停止列表中移除（如果存在）
      stoppedDownloadIds.delete(downloadId);
      
      // 取消延迟标记的timeout
      if (downloadInfo && downloadInfo.markTimeout) {
        clearTimeout(downloadInfo.markTimeout);
        console.log(`⏰ 错误处理中已取消下载ID ${downloadId} 的延迟标记`);
      }
      
      if (error.name === 'AbortError') {
        console.log('🛑 下载被中断:', videoData.title);
        throw error;
      }
      
      // 检查是否是用户停止下载的错误
      if (error.message && error.message.includes('Download stopped by user')) {
        console.log('🛑 用户停止下载:', videoData.title);
        const stopError = new Error('Download stopped by user');
        stopError.name = 'AbortError';
        throw stopError;
      }
      
      console.error('❌ 委托下载失败:', error);
      // 如果委托失败，使用chrome.downloads直接下载
      return await downloadViaChrome(videoUrl, filename, currentDownloadController, downloadId);
    } finally {
    // 下载完成后清理控制器
    if (currentDownloadController) {
      currentDownloadController = null;
    }
  }
}

// 直接使用Chrome下载API（备用方案）
async function downloadViaChrome(videoUrl, filename, abortController, downloadId) {
  console.log('使用Chrome Downloads API直接下载...');
  
  // 检查是否已被中断
  if (abortController && abortController.signal.aborted) {
    throw new Error('Download aborted before start');
  }
  
  return new Promise((resolve, reject) => {
    // 监听中断信号
    if (abortController) {
      const handleAbort = () => {
        console.log('🛑 Chrome下载被中断');
        if (downloadId) {
          inFlightDownloads.delete(downloadId);
        }
        reject(new Error('Download aborted'));
      };
      abortController.signal.addEventListener('abort', handleAbort);
    }
    
    chrome.downloads.download({
      url: videoUrl,
      filename: `抖音视频/${filename}`,
      saveAs: false
    }, (downloadId_chrome) => {
      if (chrome.runtime.lastError) {
        console.error('下载API错误:', chrome.runtime.lastError.message);
        if (downloadId) {
          inFlightDownloads.delete(downloadId);
        }
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        console.log('✅ 下载已开始，ID:', downloadId_chrome);
        resolve(downloadId_chrome);
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
  
  // 重置停止下载标志，允许新的下载继续
  stopDownload = false;
  console.log('🔄 已重置停止下载标志');
  
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
