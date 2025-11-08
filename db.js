// IndexedDB 数据库管理模块
// 提供持久化存储，支持细粒度的用户和视频管理

const DB_NAME = 'DouyinDownloaderDB';
const DB_VERSION = 3;

// 数据库实例
let db = null;
let dbInitPromise = null; // 初始化Promise，避免重复初始化

function clearCachedDB() {
  db = null;
  dbInitPromise = null;
}

function resetDBConnection() {
  if (db) {
    try {
      db.close();
    } catch (error) {
      console.warn('⚠️ 关闭数据库连接时出错:', error);
    }
  }
  clearCachedDB();
}

const RETRYABLE_IDB_ERROR_NAMES = new Set([
  'InvalidStateError',
  'TransactionInactiveError'
]);

function isRetryableIDBError(error) {
  if (!error) {
    return false;
  }
  if (error instanceof DOMException) {
    return RETRYABLE_IDB_ERROR_NAMES.has(error.name);
  }
  return false;
}

async function withDBRetry(operation, retries = 1) {
  let attempt = 0;
  while (true) {
    try {
      const database = await getDB();
      return await operation(database);
    } catch (error) {
      if (isRetryableIDBError(error) && attempt < retries) {
        attempt++;
        console.warn('⚠️ IndexedDB 操作失败，重置连接后重试 (第', attempt, '次):', error);
        resetDBConnection();
        continue;
      }
      throw error;
    }
  }
}

// 初始化数据库
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    // 数据库升级（创建表结构）
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      const oldVersion = event.oldVersion;
      console.log('📚 数据库升级中，从版本', oldVersion, '到版本', DB_VERSION);
      
      // 如果升级数据库，删除旧的config表（如果存在）
      if (db.objectStoreNames.contains('config')) {
        db.deleteObjectStore('config');
        console.log('🗑️ 删除旧的config表');
      }
      
      // 1. 关注用户表
      if (!db.objectStoreNames.contains('users')) {
        const userStore = db.createObjectStore('users', { keyPath: 'userId' });
        userStore.createIndex('nickname', 'nickname', { unique: false });
        userStore.createIndex('enabled', 'enabled', { unique: false });
        userStore.createIndex('lastCheckTime', 'lastCheckTime', { unique: false });
        console.log('✅ 创建 users 表');
      }
      
      // 2. 视频记录表
      if (!db.objectStoreNames.contains('videos')) {
        const videoStore = db.createObjectStore('videos', { keyPath: 'awemeId' });
        videoStore.createIndex('userId', 'userId', { unique: false });
        videoStore.createIndex('author', 'author', { unique: false });
        videoStore.createIndex('downloadTime', 'downloadTime', { unique: false });
        videoStore.createIndex('downloaded', 'downloaded', { unique: false });
        videoStore.createIndex('userId_downloaded', ['userId', 'downloaded'], { unique: false });
        console.log('✅ 创建 videos 表');
      }
      
      // 3. 配置表
      if (!db.objectStoreNames.contains('config')) {
        const configStore = db.createObjectStore('config', { keyPath: 'key' });
        configStore.createIndex('key', 'key', { unique: true });
        console.log('✅ 创建 config 表');
      }
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      if (db) {
        db.onversionchange = () => {
          console.warn('⚠️ 数据库版本变更，重置连接');
          resetDBConnection();
        };
        db.onclose = () => {
          console.warn('⚠️ 数据库连接已关闭，等待重新初始化');
          clearCachedDB();
        };
      }
      console.log('✅ 数据库连接成功');
      resolve(db);
    };
    
    request.onerror = (event) => {
      console.error('❌ 数据库连接失败:', event.target.error);
      reject(event.target.error);
    };
  });
}

// 获取数据库实例
async function getDB() {
  if (db) {
    return db;
  }
  
  if (!dbInitPromise) {
    dbInitPromise = initDB();
  }
  
  db = await dbInitPromise;
  return db;
}

// ==================== 用户管理 ====================

/**
 * 添加或更新用户
 * @param {Object} user - 用户信息
 * @param {string} user.userId - 用户ID (sec_uid)
 * @param {string} user.nickname - 昵称
 * @param {string} user.avatar - 头像URL
 * @param {boolean} user.enabled - 是否启用自动下载（默认true）
 */
async function saveUser(user) {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    // 验证userId
    if (!user.userId || typeof user.userId !== 'string') {
      console.error('❌ 无效的userId:', user.userId);
      reject(new Error('userId必须是有效的字符串'));
      return;
    }
    
    const transaction = database.transaction(['users'], 'readwrite');
    const store = transaction.objectStore('users');
    
    // 合并默认值
    const userData = {
      userId: user.userId,
      nickname: user.nickname || '未知用户',
      avatar: user.avatar || '',
      enabled: user.enabled !== undefined ? user.enabled : true,
      addedTime: user.addedTime || Date.now(),
      lastCheckTime: user.lastCheckTime || null,
      videoCount: user.videoCount || 0 // 确保初始化为0
    };
    
    const request = store.put(userData);
    
    request.onsuccess = () => {
      console.log('✅ 保存用户:', userData.nickname);
      resolve(userData);
    };
    
    request.onerror = (event) => {
      console.error('❌ 保存用户失败:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * 批量添加或更新用户
 */
async function saveUsers(users) {
  const results = [];
  for (const user of users) {
    try {
      const result = await saveUser(user);
      results.push(result);
    } catch (error) {
      console.error('保存用户失败:', user.nickname, error);
    }
  }
  return results;
}

/**
 * 获取单个用户
 */
async function getUser(userId) {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['users'], 'readonly');
    const store = transaction.objectStore('users');
    const request = store.get(userId);
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * 获取所有用户
 * @param {Object} filter - 过滤条件
 * @param {boolean} filter.enabledOnly - 只返回启用的用户
 * @param {boolean} filter.withVideoCount - 是否计算每个用户的视频数量（默认true）
 */
async function getAllUsers(filter = {}) {
  const database = await getDB();
  const withVideoCount = filter.withVideoCount !== false; // 默认为true
  
  return new Promise(async (resolve, reject) => {
    try {
      const transaction = database.transaction(['users', 'videos'], 'readonly');
      const userStore = transaction.objectStore('users');
      const request = userStore.getAll();
      
      request.onsuccess = async (event) => {
        let users = event.target.result;
        
        // 如果需要统计视频数量
        if (withVideoCount) {
          const videoStore = transaction.objectStore('videos');
          
          // 为每个用户统计视频数量
          for (const user of users) {
            const userVideosRequest = videoStore.index('userId').count(user.userId);
            const count = await new Promise((res, rej) => {
              userVideosRequest.onsuccess = (e) => res(e.target.result);
              userVideosRequest.onerror = (e) => rej(e.target.error);
            });
            user.videoCount = count;
          }
        }
        
        // 应用过滤条件
        if (filter.enabledOnly) {
          users = users.filter(u => u.enabled);
        }
        
        // 按添加时间倒序
        users.sort((a, b) => b.addedTime - a.addedTime);
        
        resolve(users);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 切换用户启用状态
 */
async function toggleUserEnabled(userId) {
  const user = await getUser(userId);
  if (user) {
    user.enabled = !user.enabled;
    return await saveUser(user);
  }
  return null;
}

/**
 * 删除用户（同时删除该用户的所有视频记录）
 */
async function deleteUser(userId) {
  const database = await getDB();
  return new Promise(async (resolve, reject) => {
    try {
      // 先删除该用户的所有视频
      await deleteVideosByUser(userId);
      
      // 再删除用户
      const transaction = database.transaction(['users'], 'readwrite');
      const store = transaction.objectStore('users');
      const request = store.delete(userId);
      
      request.onsuccess = () => {
        console.log('✅ 删除用户:', userId);
        resolve(true);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 更新用户的最后检查时间
 */
async function updateUserLastCheck(userId) {
  const user = await getUser(userId);
  if (user) {
    user.lastCheckTime = Date.now();
    return await saveUser(user);
  }
  return null;
}

// ==================== 视频管理 ====================

/**
 * 添加或更新视频记录
 * @param {Object} video - 视频信息
 * @param {string} video.awemeId - 视频ID
 * @param {string} video.userId - 作者ID
 * @param {string} video.author - 作者昵称
 * @param {string} video.title - 视频标题
 * @param {string} video.videoUrl - 视频URL
 * @param {string} video.coverUrl - 封面URL
 * @param {number} video.duration - 视频时长
 * @param {number} video.createTime - 视频创建时间
 * @param {boolean} video.downloaded - 是否已下载
 * @param {boolean} preserveDownloadStatus - 如果视频已存在且已下载，保留下载状态（默认false）
 */
async function saveVideo(video, preserveDownloadStatus = false) {
  const database = await getDB();
  return new Promise(async (resolve, reject) => {
    try {
      // 验证awemeId
      if (!video.awemeId || typeof video.awemeId !== 'string') {
        console.error('❌ 无效的awemeId:', video.awemeId);
        reject(new Error('awemeId必须是有效的字符串'));
        return;
      }
      
      const transaction = database.transaction(['videos', 'users'], 'readwrite');
      const videoStore = transaction.objectStore('videos');
      const userStore = transaction.objectStore('users');
      
      // 如果需要保留下载状态，先查询现有记录
      let existingVideo = null;
      if (preserveDownloadStatus) {
        const getRequest = videoStore.get(video.awemeId);
        existingVideo = await new Promise((res, rej) => {
          getRequest.onsuccess = (e) => res(e.target.result);
          getRequest.onerror = (e) => rej(e.target.error);
        });
      }
      
      // 如果是新视频且有关联用户，更新用户计数
      const isNewVideo = !existingVideo && video.userId && video.userId !== 'unknown';
      if (isNewVideo) {
        const userRequest = userStore.get(video.userId);
        const user = await new Promise((res, rej) => {
          userRequest.onsuccess = (e) => res(e.target.result);
          userRequest.onerror = (e) => rej(e.target.error);
        });
        
        if (user) {
          user.videoCount = (user.videoCount || 0) + 1;
          userStore.put(user);
        }
      }
      
      const videoData = {
        awemeId: video.awemeId,
        userId: video.userId || 'unknown',
        author: video.author || '未知作者',
        title: video.title || '未知标题',
        videoUrl: video.videoUrl || '',
        coverUrl: video.coverUrl || '',
        duration: video.duration || 0,
        createTime: video.createTime || Date.now(),
        // 如果已存在且已下载，保留原状态；否则使用新状态
        downloaded: (existingVideo && existingVideo.downloaded) ? true : (video.downloaded || false),
        downloadTime: (existingVideo && existingVideo.downloadTime) ? existingVideo.downloadTime : (video.downloadTime || null),
        filename: (existingVideo && existingVideo.filename) ? existingVideo.filename : (video.filename || null),
        addedTime: (existingVideo && existingVideo.addedTime) ? existingVideo.addedTime : (video.addedTime || Date.now())
      };
      
      const request = videoStore.put(videoData);
      
      request.onsuccess = () => {
        resolve(videoData);
      };
      
      request.onerror = (event) => {
        reject(event.target.error);
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 批量保存视频
 * @param {Array} videos - 视频数组
 * @param {boolean} preserveDownloadStatus - 是否保留已下载视频的状态（默认false）
 */
async function saveVideos(videos, preserveDownloadStatus = false) {
  // 使用单独的 saveVideo 调用，利用其保护逻辑
  const promises = videos.map(video => saveVideo(video, preserveDownloadStatus));
  return await Promise.all(promises);
}

/**
 * 获取单个视频
 */
async function getVideo(awemeId) {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['videos'], 'readonly');
    const store = transaction.objectStore('videos');
    const request = store.get(awemeId);
    
    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
    
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * 检查视频是否已下载
 */
async function isVideoDownloaded(awemeId) {
  const video = await getVideo(awemeId);
  return video ? video.downloaded : false;
}

/**
 * 获取用户的所有视频
 * @param {string} userId - 用户ID
 * @param {Object} filter - 过滤条件
 * @param {boolean} filter.downloadedOnly - 只返回已下载的
 * @param {boolean} filter.notDownloadedOnly - 只返回未下载的
 */
async function getVideosByUser(userId, filter = {}) {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['videos'], 'readonly');
    const store = transaction.objectStore('videos');
    const index = store.index('userId');
    const request = index.getAll(userId);
    
    request.onsuccess = (event) => {
      let videos = event.target.result;
      
      // 应用过滤
      if (filter.downloadedOnly) {
        videos = videos.filter(v => v.downloaded);
      } else if (filter.notDownloadedOnly) {
        videos = videos.filter(v => !v.downloaded);
      }
      
      // 按创建时间倒序排序
      videos.sort((a, b) => b.createTime - a.createTime);
      
      resolve(videos);
    };
    
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * 获取所有已下载的视频
 */
async function getAllDownloadedVideos() {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['videos'], 'readonly');
    const store = transaction.objectStore('videos');
    // 使用getAll()获取所有视频，然后过滤（更可靠）
    const request = store.getAll();
    
    request.onsuccess = (event) => {
      const allVideos = event.target.result;
      console.log('📊 数据库中共有', allVideos.length, '个视频记录');
      
      // 过滤出已下载的视频
      const downloadedVideos = allVideos.filter(v => v.downloaded === true);
      console.log('✅ 其中已下载:', downloadedVideos.length, '个');
      
      // 按下载时间倒序排序
      downloadedVideos.sort((a, b) => (b.downloadTime || 0) - (a.downloadTime || 0));
      resolve(downloadedVideos);
    };
    
    request.onerror = (event) => {
      console.error('❌ 获取视频列表失败:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * 标记视频为已下载
 */
async function markVideoAsDownloaded(awemeId, filename) {
  const video = await getVideo(awemeId);
  if (video) {
    video.downloaded = true;
    video.downloadTime = Date.now();
    video.filename = filename;
    return await saveVideo(video);
  }
  return null;
}

/**
 * 删除用户的所有视频记录
 */
async function deleteVideosByUser(userId) {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['videos'], 'readwrite');
    const store = transaction.objectStore('videos');
    const index = store.index('userId');
    const request = index.openCursor(userId);
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        console.log('✅ 删除用户所有视频:', userId);
        resolve(true);
      }
    };
    
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * 删除单个视频记录
 */
async function deleteVideo(awemeId) {
  const database = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(['videos'], 'readwrite');
    const store = transaction.objectStore('videos');
    const request = store.delete(awemeId);
    
    request.onsuccess = () => {
      console.log('✅ 删除视频:', awemeId);
      resolve(true);
    };
    
    request.onerror = (event) => {
      reject(event.target.error);
    };
  });
}

/**
 * 获取统计信息
 */
async function getStats() {
  const database = await getDB();
  return new Promise(async (resolve, reject) => {
    try {
      const users = await getAllUsers();
      const allVideos = await new Promise((res, rej) => {
        const transaction = database.transaction(['videos'], 'readonly');
        const store = transaction.objectStore('videos');
        const request = store.getAll();
        request.onsuccess = (e) => res(e.target.result);
        request.onerror = (e) => rej(e.target.error);
      });
      
      const downloadedVideos = allVideos.filter(v => v.downloaded);
      
      // 按用户统计
      const userStats = {};
      for (const user of users) {
        const userVideos = allVideos.filter(v => v.userId === user.userId);
        const userDownloaded = userVideos.filter(v => v.downloaded);
        userStats[user.userId] = {
          nickname: user.nickname,
          enabled: user.enabled,
          totalVideos: userVideos.length,
          downloadedVideos: userDownloaded.length,
          pendingVideos: userVideos.length - userDownloaded.length
        };
      }
      
      resolve({
        totalUsers: users.length,
        enabledUsers: users.filter(u => u.enabled).length,
        totalVideos: allVideos.length,
        downloadedVideos: downloadedVideos.length,
        pendingVideos: allVideos.length - downloadedVideos.length,
        userStats
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ==================== 配置管理 ====================

/**
 * 保存配置项
 */
async function saveConfig(key, value) {
  console.log('🔍 saveConfig 被调用:', {
    key,
    value,
    keyType: typeof key,
    valueType: typeof value,
    caller: new Error().stack.split('\n')[2]
  });
  
  if (key === undefined) {
    console.error('❌ saveConfig 调用参数无效: key为undefined', {
      value,
      valueType: typeof value,
      stack: new Error().stack
    });
    throw new Error('Config key must be a non-empty string (received: undefined)');
  }
  
  const normalizedKey = key != null ? String(key).trim() : '';
  if (!normalizedKey) {
    console.error('❌ saveConfig 调用参数无效:', {
      originalKey: key,
      value,
      stack: new Error().stack
    });
    throw new Error(`Config key must be a non-empty string (received: ${key})`);
  }

  return withDBRetry((database) => {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['config'], 'readwrite');
      const store = transaction.objectStore('config');
      
      // Create or update the config with the key and value
      const data = { key: normalizedKey, value };
      const request = store.put(data);
      
      request.onsuccess = () => {
        console.log('✅ 配置已保存:', normalizedKey, '=', value);
        resolve(value);
      };
      
      request.onerror = (event) => {
        console.error('❌ 保存配置失败:', {
          error: event.target.error,
          key: normalizedKey,
          value
        });
        reject(event.target.error);
      };
    });
  }, 1);
}

/**
 * 获取配置项
 */
async function getConfig(key, defaultValue = null) {
  const normalizedKey = key != null ? String(key).trim() : '';
  if (!normalizedKey) {
    return defaultValue;
  }

  return withDBRetry((database) => {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['config'], 'readonly');
      const store = transaction.objectStore('config');
      const request = store.get(normalizedKey);
      
      request.onsuccess = (event) => {
        const result = event.target.result;
        resolve(result !== undefined ? result.value : defaultValue);
      };
      
      request.onerror = (event) => {
        console.error('❌ 获取配置失败:', {
          error: event.target.error,
          key: normalizedKey
        });
        reject(event.target.error);
      };
    });
  }, 1);
}

// ==================== 数据迁移 ====================

/**
 * 从chrome.storage.local迁移旧数据
 */
async function migrateFromChromeStorage() {
  try {
    console.log('🔄 开始数据迁移...');
    
    // 检查是否已迁移
    const migrated = await getConfig('migrated', false);
    if (migrated) {
      console.log('✅ 数据已迁移，跳过');
      return;
    }
    
    // 检查chrome.storage是否可用
    if (!chrome.storage || !chrome.storage.local) {
      console.log('⚠️ chrome.storage不可用，跳过迁移');
      // 标记为已迁移以避免重复尝试
      await saveConfig('migrated', true);
      return;
    }
    
    // 获取旧数据
    const data = await chrome.storage.local.get(['downloadedVideos', 'config']);
    
    if (data.downloadedVideos && data.downloadedVideos.length > 0) {
      console.log('📦 发现', data.downloadedVideos.length, '个已下载视频记录');
      
      // 迁移视频记录（创建最小化的视频对象）
      const videos = data.downloadedVideos.map(awemeId => ({
        awemeId,
        userId: 'unknown',
        author: '未知作者',
        title: '历史视频',
        videoUrl: '',
        downloaded: true,
        downloadTime: Date.now(),
        addedTime: Date.now()
      }));
      
      await saveVideos(videos);
      console.log('✅ 迁移', videos.length, '个视频记录');
    }
    
    // 迁移配置
    if (data.config) {
      if (data.config.autoDownload !== undefined) {
        await saveConfig('autoDownload', data.config.autoDownload);
      }
      if (data.config.checkInterval !== undefined) {
        await saveConfig('checkInterval', data.config.checkInterval);
      }
      if (data.config.minDelay !== undefined) {
        await saveConfig('minDelay', data.config.minDelay);
      }
      if (data.config.maxDelay !== undefined) {
        await saveConfig('maxDelay', data.config.maxDelay);
      }
      console.log('✅ 迁移配置');
    }
    
    // 标记为已迁移
    await saveConfig('migrated', true);
    console.log('✅ 数据迁移完成');
    
  } catch (error) {
    console.error('❌ 数据迁移失败:', error);
    // 即使迁移失败，也标记为已迁移以避免无限重试
    try {
      await saveConfig('migrated', true);
    } catch (e) {
      console.error('❌ 标记迁移状态失败:', e);
    }
  }
}

// ==================== 导出API ====================

// 导出到全局（兼容 Service Worker 和普通页面）
const DouyinDB = {
  // 初始化
  initDB,
  getDB,
  
  // 用户管理
  saveUser,
  saveUsers,
  getUser,
  getAllUsers,
  toggleUserEnabled,
  deleteUser,
  updateUserLastCheck,
  
  // 视频管理
  saveVideo,
  saveVideos,
  getVideo,
  isVideoDownloaded,
  getVideosByUser,
  getAllDownloadedVideos,
  markVideoAsDownloaded,
  deleteVideo,
  deleteVideosByUser,
  
  // 统计
  getStats,
  
  // 配置
  saveConfig,
  getConfig,
  
  // 迁移
  migrateFromChromeStorage
};

// 在不同环境中导出
if (typeof self !== 'undefined') {
  // Service Worker 环境
  self.DouyinDB = DouyinDB;
}
if (typeof window !== 'undefined') {
  // 普通页面环境
  window.DouyinDB = DouyinDB;
}
