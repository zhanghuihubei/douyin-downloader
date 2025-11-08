// 管理界面脚本

let allUsers = [];
let allVideos = [];

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  console.log('📋 管理页面加载...');
  
  try {
    // 加载数据
    await loadData();
    
    // 绑定标签切换
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        console.log('切换到标签:', tabName);
        switchTab(tabName);
      });
    });
    
    console.log('✅ 管理页面初始化完成');
    
    // 绑定批量删除按钮
    document.getElementById('deleteAllBtn').addEventListener('click', handleDeleteAll);
    document.getElementById('deleteZeroVideoUsersBtn').addEventListener('click', handleDeleteZeroVideoUsers);
    
    // 绑定模态框关闭按钮
    document.getElementById('closeModalBtn').addEventListener('click', closeVideoModal);
    
    // 绑定停止下载按钮
    document.getElementById('stopDownloadBtn').addEventListener('click', stopDownload);
  } catch (error) {
    console.error('❌ 管理页面初始化失败:', error);
  }
});

// 切换标签
function switchTab(tabName) {
  // 更新标签状态
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  // 更新内容区域
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}Tab`).classList.add('active');
}

// 加载数据
async function loadData() {
  console.log('🔄 开始加载数据...');
  
  try {
    // 获取统计信息
    console.log('📊 获取统计信息...');
    const statsResponse = await chrome.runtime.sendMessage({ action: 'getStats' });
    console.log('统计信息响应:', statsResponse);
    
    if (statsResponse && statsResponse.success) {
      updateStats(statsResponse.stats);
      console.log('✅ 统计信息已更新');
    } else {
      console.warn('⚠️ 获取统计信息失败:', statsResponse);
    }
    
    // 获取下载状态
    console.log('📊 获取下载状态...');
    const statusResponse = await chrome.runtime.sendMessage({ action: 'getStatus' });
    console.log('下载状态响应:', statusResponse);
    
    if (statusResponse && statusResponse.success) {
      updateDownloadStatus(statusResponse.status);
      console.log('✅ 下载状态已更新');
    } else {
      console.warn('⚠️ 获取下载状态失败:', statusResponse);
    }
    
    // 获取用户列表
    console.log('👥 获取用户列表...');
    const usersResponse = await chrome.runtime.sendMessage({ action: 'getAllUsers' });
    console.log('用户列表响应:', usersResponse);
    
    if (usersResponse && usersResponse.success) {
      allUsers = usersResponse.users || [];
      console.log('✅ 加载了', allUsers.length, '个用户');
      // 先渲染用户（此时videoCount可能不准确）
      renderUsers();
    } else {
      console.warn('⚠️ 获取用户列表失败:', usersResponse);
      allUsers = [];
      renderUsers();
    }
    
    // 获取所有已下载视频
    console.log('🎬 获取视频列表...');
    const videosResponse = await chrome.runtime.sendMessage({ action: 'getAllDownloadedVideos' });
    console.log('视频列表响应:', videosResponse);
    
    if (videosResponse && videosResponse.success) {
      allVideos = videosResponse.videos || [];
      console.log('✅ 加载了', allVideos.length, '个已下载视频');
      
      // 更新用户视频计数
      updateUserVideoCounts();
      
      // 重新渲染用户列表（现在videoCount是准确的）
      renderUsers();
      
      renderVideos();
    } else {
      console.warn('⚠️ 获取视频列表失败:', videosResponse?.error);
      allVideos = [];
      renderVideos();
    }
    
    console.log('✅ 数据加载完成');
  } catch (error) {
    console.error('❌ 加载数据失败:', error);
  }
}

// 更新统计信息
function updateStats(stats) {
  document.getElementById('totalUsers').textContent = stats.totalUsers;
  document.getElementById('enabledUsers').textContent = stats.enabledUsers;
  document.getElementById('totalVideos').textContent = stats.totalVideos;
  document.getElementById('downloadedVideos').textContent = stats.downloadedVideos;
  document.getElementById('pendingVideos').textContent = stats.pendingVideos;
}

// 渲染用户列表
function renderUsers() {
  console.log('渲染用户列表，用户数量:', allUsers.length);
  allUsers.forEach(user => {
    console.log(`用户 ${user.nickname} (${user.userId}) 视频数量: ${user.videoCount}`);
  });
  const container = document.getElementById('usersList');
  const infoSpan = document.getElementById('userListInfo');
  const deleteZeroBtn = document.getElementById('deleteZeroVideoUsersBtn');
  
  // 统计0视频用户
  const zeroVideoUsers = allUsers.filter(u => (u.videoCount || 0) === 0);
  
  // 更新信息栏
  if (allUsers.length > 0) {
    infoSpan.innerHTML = `
      共 ${allUsers.length} 个用户
      ${zeroVideoUsers.length > 0 ? `<span style="color: #dc3545; margin-left: 10px;">⚠️ ${zeroVideoUsers.length} 个用户没有视频</span>` : ''}
    `;
    if (zeroVideoUsers.length > 0) {
      deleteZeroBtn.style.display = 'block';
    } else {
      deleteZeroBtn.style.display = 'none';
    }
  } else {
    infoSpan.textContent = '';
    deleteZeroBtn.style.display = 'none';
  }
  
  if (allUsers.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <div class="empty-state-text">暂无关注用户</div>
        <div class="empty-state-hint">请在抖音页面点击"获取关注列表"</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = allUsers.map((user, index) => {
    const hasNoVideos = (user.videoCount || 0) === 0;
    return `
    <div class="user-card ${user.enabled ? '' : 'disabled'} ${hasNoVideos ? 'zero-videos' : ''}" data-user-id="${user.userId}" data-user-index="${index}" style="${hasNoVideos ? 'border-color: #ffc107; background: #fff9e6;' : ''}">
      ${hasNoVideos ? '<div style="background: #fff3cd; color: #856404; padding: 5px 10px; font-size: 12px; margin-bottom: 10px; border-radius: 4px;">该用户没有视频</div>' : ''}
      <div class="user-header">
        <img class="user-avatar" src="${user.avatar || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="50" height="50"%3E%3Crect fill="%23ddd" width="50" height="50"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3E%3F%3C/text%3E%3C/svg%3E'}" alt="${user.nickname}">
        <div class="user-info">
          <div class="user-nickname">${escapeHtml(user.nickname)}</div>
          <div class="user-status">${user.enabled ? '✅ 已启用' : '⏸️ 已禁用'}</div>
        </div>
      </div>
      <div class="user-stats">
        <span style="${hasNoVideos ? 'color: #dc3545; font-weight: bold;' : ''}">📹 ${user.videoCount || 0} 视频</span>
        <span>⏱️ ${user.lastCheckTime ? formatTime(user.lastCheckTime) : '未检查'}</span>
      </div>
      <div class="user-actions">
        <button class="btn btn-primary toggle-user-btn" data-user-id="${user.userId}">
          ${user.enabled ? '禁用' : '启用'}
        </button>
        <button class="btn btn-secondary view-videos-btn" data-user-id="${user.userId}">
          查看视频
        </button>
        <button class="btn btn-danger delete-user-btn" data-user-id="${user.userId}">
          删除
        </button>
      </div>
    </div>
  `;
  }).join('');
  
  // 使用事件委托绑定用户操作按钮
  container.querySelectorAll('.toggle-user-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const userId = this.getAttribute('data-user-id');
      toggleUser(userId);
    });
  });
  
  container.querySelectorAll('.view-videos-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const userId = this.getAttribute('data-user-id');
      viewUserVideos(userId);
    });
  });
  
  container.querySelectorAll('.delete-user-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const userId = this.getAttribute('data-user-id');
      const userIndex = parseInt(this.closest('.user-card').getAttribute('data-user-index'));
      const user = allUsers[userIndex];
      handleDeleteUser(userId, user.nickname);
    });
  });
}

// 渲染视频列表
function renderVideos() {
  const container = document.getElementById('videosList');
  const infoSpan = document.getElementById('videoListInfo');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  
  // 更新信息栏
  if (allVideos.length > 0) {
    infoSpan.innerHTML = `共 ${allVideos.length} 个视频`;
    deleteAllBtn.style.display = 'block';
  } else {
    infoSpan.textContent = '';
    deleteAllBtn.style.display = 'none';
  }
  
  if (allVideos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎬</div>
        <div class="empty-state-text">暂无已下载视频</div>
        <div class="empty-state-hint">下载视频后会显示在这里</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = allVideos.map((video, index) => {
    const isMigrated = video.userId === 'unknown' || video.author === '未知作者';
    return `
    <div class="video-item ${isMigrated ? '' : ''}" data-video-id="${video.awemeId}" data-video-index="${index}" style="${isMigrated ? '' : ''}">
      <img class="video-cover" src="${video.coverUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="90"%3E%3Crect fill="%23ddd" width="120" height="90"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3E封面%3C/text%3E%3C/svg%3E'}" alt="封面">
      <div class="video-info">
        <div class="video-title">${escapeHtml(video.title)}</div>
        <div class="video-meta">👤 作者: ${escapeHtml(video.author)}</div>
        <div class="video-meta">📹 时长: ${formatDuration(video.duration)}</div>
        <div class="video-meta">📅 发布: ${formatDate(video.createTime)}</div>
        <div class="video-meta">
          <span class="video-status ${video.downloaded ? 'downloaded' : 'pending'}">
            ${video.downloaded ? '✅ 已下载' : '⏳ 待下载'}
          </span>
          ${video.downloaded && video.downloadTime ? `<span style="margin-left: 10px;">⏰ ${formatTime(video.downloadTime)}</span>` : ''}
        </div>
        ${video.filename ? `<div class="video-meta">📁 文件: ${escapeHtml(video.filename)}</div>` : ''}
        <div class="video-meta" style="font-size: 11px; color: #999;">🆔 ${video.awemeId}</div>
        <div class="user-actions" style="margin-top: 10px;">
          <button class="btn btn-danger delete-video-btn" data-aweme-id="${video.awemeId}">
            🗑️ 删除记录
          </button>
        </div>
      </div>
    </div>
  `;
  }).join('');
  
  // 使用事件委托绑定删除按钮
  container.querySelectorAll('.delete-video-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const awemeId = this.getAttribute('data-aweme-id');
      const videoIndex = parseInt(this.closest('.video-item').getAttribute('data-video-index'));
      const video = allVideos[videoIndex];
      handleDeleteVideo(awemeId, video.title);
    });
  });
  
  // Handle image errors
  container.querySelectorAll('.video-cover').forEach(img => {
    img.addEventListener('error', function() {
      this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="90"%3E%3Crect fill="%23ddd" width="120" height="90"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3E封面%3C/text%3E%3C/svg%3E';
    });
  });
}

// 删除视频记录处理函数
async function handleDeleteVideo(awemeId, title) {
  console.log('🗑️ 请求删除视频:', awemeId, title);
  
  if (!confirm(`确定要删除视频"${title}"的记录吗？\n\n注意：这只会删除下载记录，不会删除已下载的文件。`)) {
    console.log('❌ 用户取消删除');
    return;
  }
  
  try {
    console.log('📨 发送删除请求到后台...');
    const response = await chrome.runtime.sendMessage({ 
      action: 'deleteVideo', 
      awemeId 
    });
    
    console.log('📩 删除响应:', response);
    
    if (response && response.success) {
      console.log('✅ 视频记录已删除');
      await loadData(); // 重新加载数据
    } else {
      console.error('❌ 删除失败:', response?.error);
      alert('删除失败: ' + (response?.error || '未知错误'));
    }
  } catch (error) {
    console.error('❌ 删除视频记录失败:', error);
    alert('删除失败: ' + error.message);
  }
}

// HTML转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 删除全部视频记录
async function handleDeleteAll() {
  const count = allVideos.length;
  
  if (!confirm(`⚠️ 确定要删除全部 ${count} 个视频记录吗？\n\n这将删除所有视频的下载记录（不会删除已下载的文件）。\n\n此操作不可恢复！`)) {
    console.log('❌ 用户取消删除全部');
    return;
  }
  
  // 二次确认
  if (!confirm(`再次确认：真的要删除全部 ${count} 个记录吗？`)) {
    console.log('❌ 用户取消删除全部（二次确认）');
    return;
  }
  
  console.log('🗑️ 开始批量删除', count, '个视频记录...');
  
  let successCount = 0;
  let failCount = 0;
  
  // 显示进度
  const container = document.getElementById('videosList');
  container.innerHTML = `
    <div class="loading">
      <div style="font-size: 24px; margin-bottom: 20px;">🗑️</div>
      <div>正在删除视频记录...</div>
      <div style="margin-top: 10px; font-size: 14px; color: #6c757d;">
        <span id="deleteProgress">0</span> / ${count}
      </div>
    </div>
  `;
  
  for (let i = 0; i < allVideos.length; i++) {
    const video = allVideos[i];
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'deleteVideo', 
        awemeId: video.awemeId
      });
      
      if (response && response.success) {
        successCount++;
      } else {
        failCount++;
        console.error('删除失败:', video.awemeId, response?.error);
      }
    } catch (error) {
      failCount++;
      console.error('删除失败:', video.awemeId, error);
    }
    
    // 更新进度
    document.getElementById('deleteProgress').textContent = i + 1;
  }
  
  console.log(`✅ 批量删除完成: 成功 ${successCount}, 失败 ${failCount}`);
  alert(`删除完成！\n\n成功: ${successCount} 个\n失败: ${failCount} 个`);
  
  // 重新加载数据
  await loadData();
}

// 删除0视频用户
async function handleDeleteZeroVideoUsers() {
  const zeroVideoUsers = allUsers.filter(u => (u.videoCount || 0) === 0);
  const count = zeroVideoUsers.length;
  
  if (count === 0) {
    alert('没有0视频的用户需要删除');
    return;
  }
  
  if (!confirm(`⚠️ 发现 ${count} 个用户没有视频\n\n确定要删除这些用户吗？\n\n删除原因：\n• 可能是新关注的用户还未获取视频\n• 可能是该用户已删除所有视频\n• 可能是数据迁移导致的空用户\n\n此操作不可恢复！`)) {
    console.log('❌ 用户取消删除0视频用户');
    return;
  }
  
  console.log('🗑️ 开始删除', count, '个0视频用户...');
  
  let successCount = 0;
  let failCount = 0;
  
  // 显示进度
  const container = document.getElementById('usersList');
  container.innerHTML = `
    <div class="loading">
      <div style="font-size: 24px; margin-bottom: 20px;">🗑️</div>
      <div>正在删除0视频用户...</div>
      <div style="margin-top: 10px; font-size: 14px; color: #6c757d;">
        <span id="deleteZeroProgress">0</span> / ${count}
      </div>
    </div>
  `;
  
  for (let i = 0; i < zeroVideoUsers.length; i++) {
    const user = zeroVideoUsers[i];
    try {
      const response = await chrome.runtime.sendMessage({ 
        action: 'deleteUser', 
        userId: user.userId
      });
      
      if (response && response.success) {
        successCount++;
        console.log('✅ 已删除:', user.nickname);
      } else {
        failCount++;
        console.error('删除失败:', user.userId, response?.error);
      }
    } catch (error) {
      failCount++;
      console.error('删除失败:', user.userId, error);
    }
    
    // 更新进度
    document.getElementById('deleteZeroProgress').textContent = i + 1;
  }
  
  console.log(`✅ 删除0视频用户完成: 成功 ${successCount}, 失败 ${failCount}`);
  alert(`删除完成！\n\n成功: ${successCount} 个\n失败: ${failCount} 个\n\n页面将自动刷新。`);
  
  // 重新加载数据
  await loadData();
}

// 切换用户启用状态
async function toggleUser(userId) {
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'toggleUser', 
      userId 
    });
    
    if (response.success) {
      console.log('✅ 用户状态已更新');
      await loadData();
    } else {
      alert('操作失败: ' + response.error);
    }
  } catch (error) {
    console.error('切换用户状态失败:', error);
    alert('操作失败: ' + error.message);
  }
}

// 查看用户视频
async function viewUserVideos(userId) {
  try {
    const response = await chrome.runtime.sendMessage({ 
      action: 'getUserVideos', 
      userId 
    });
    
    if (response.success) {
      showVideoModal(userId, response.videos);
    } else {
      alert('获取视频失败: ' + response.error);
    }
  } catch (error) {
    console.error('获取用户视频失败:', error);
    alert('获取视频失败: ' + error.message);
  }
}

// 显示视频模态框
function showVideoModal(userId, videos) {
  const user = allUsers.find(u => u.userId === userId);
  const modal = document.getElementById('videoModal');
  const content = document.getElementById('videoModalContent');
  
  if (videos.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎬</div>
        <div class="empty-state-text">该用户暂无视频记录</div>
      </div>
    `;
  } else {
    content.innerHTML = `
      <div style="margin-bottom: 20px;">
        <strong>${user.nickname}</strong> 的视频 (${videos.length})
      </div>
      <div class="video-list">
        ${videos.map(video => `
          <div class="video-item">
            <img class="video-cover" src="${video.coverUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="90"%3E%3Crect fill="%23ddd" width="120" height="90"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3E封面%3C/text%3E%3C/svg%3E'}" alt="封面">
            <div class="video-info">
              <div class="video-title">${video.title}</div>
              <div class="video-meta">📹 时长: ${formatDuration(video.duration)}</div>
              <div class="video-meta">📅 发布: ${formatDate(video.createTime)}</div>
              <div class="video-meta">
                <span class="video-status ${video.downloaded ? 'downloaded' : 'pending'}">
                  ${video.downloaded ? '✅ 已下载' : '⏳ 待下载'}
                </span>
                ${video.downloaded ? `<span style="margin-left: 10px;">📁 ${video.filename || ''}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  modal.classList.add('active');
  
  // Handle image errors in modal
  content.querySelectorAll('.video-cover').forEach(img => {
    img.addEventListener('error', function() {
      this.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="90"%3E%3Crect fill="%23ddd" width="120" height="90"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999"%3E封面%3C/text%3E%3C/svg%3E';
    });
  });
}

// 关闭视频模态框
function closeVideoModal() {
  document.getElementById('videoModal').classList.remove('active');
}

// 删除用户处理函数
async function handleDeleteUser(userId, nickname) {
  console.log('🗑️ 请求删除用户:', userId, nickname);
  
  if (!confirm(`确定要删除用户"${nickname}"吗？这将同时删除该用户的所有视频记录。`)) {
    console.log('❌ 用户取消删除');
    return;
  }
  
  try {
    console.log('📨 发送删除用户请求到后台...');
    const response = await chrome.runtime.sendMessage({ 
      action: 'deleteUser', 
      userId 
    });
    
    console.log('📩 删除响应:', response);
    
    if (response && response.success) {
      console.log('✅ 用户已删除');
      await loadData();
    } else {
      console.error('❌ 删除失败:', response?.error);
      alert('删除失败: ' + (response?.error || '未知错误'));
    }
  } catch (error) {
    console.error('❌ 删除用户失败:', error);
    alert('删除失败: ' + error.message);
  }
}

// 格式化时间
function formatTime(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 30) return `${days}天前`;
  return date.toLocaleDateString();
}

// 格式化日期
function formatDate(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp * 1000); // 抖音时间戳是秒
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 格式化时长
function formatDuration(ms) {
  if (!ms) return '未知';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 点击模态框外部关闭
document.getElementById('videoModal').addEventListener('click', (e) => {
  if (e.target.id === 'videoModal') {
    closeVideoModal();
  }
});

// 更新下载状态显示
function updateDownloadStatus(status) {
  const statusElement = document.getElementById('downloadStatus');
  const stopBtn = document.getElementById('stopDownloadBtn');
  
  if (status.isDownloading && status.queueLength > 0) {
    statusElement.textContent = `正在下载 (${status.queueLength} 个视频剩余)`;
    statusElement.style.color = '#28a745';
    stopBtn.style.display = 'block';
  } else if (status.queueLength > 0) {
    statusElement.textContent = `队列中有 ${status.queueLength} 个视频待下载`;
    statusElement.style.color = '#ffc107';
    stopBtn.style.display = 'none';
  } else {
    statusElement.textContent = '准备就绪';
    statusElement.style.color = '#6c757d';
    stopBtn.style.display = 'none';
  }
}

// 停止下载
async function stopDownload() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'stopDownload' });
    
    if (response.success) {
      console.log('✅ 已发送停止下载指令');
      const message = response.clearedCount 
        ? `已停止下载并清空队列，移除了 ${response.clearedCount} 个待下载视频`
        : '已发送停止指令，下载将在当前视频完成后停止';
      alert(message);
      await loadData(); // 重新加载数据以更新状态
    } else {
      alert('停止失败: ' + response.error);
    }
  } catch (error) {
    console.error('停止下载失败:', error);
    alert('停止失败: ' + error.message);
  }
}

// 更新用户视频计数
function updateUserVideoCounts() {
  // 创建用户ID到用户对象的映射
  const userMap = new Map();
  allUsers.forEach(user => {
    user.videoCount = 0; // 重置计数
    userMap.set(user.userId, user);
  });
  
  // 统计每个用户的视频数量
  allVideos.forEach(video => {
    let matchedUser = null;
    
    // 跳过未下载的视频
    if (!video.downloaded) {
      return;
    }
    
    // 优先使用userId匹配
    if (video.userId && video.userId !== 'unknown') {
      matchedUser = userMap.get(video.userId);
    }
    
    // 如果userId不匹配，尝试通过author名称匹配
    if (!matchedUser && video.author && video.author !== '未知作者') {
      for (const user of allUsers) {
        if (user.nickname === video.author) {
          matchedUser = user;
          break;
        }
      }
    }
    
    // 如果找到匹配的用户，增加计数
    if (matchedUser) {
      matchedUser.videoCount = (matchedUser.videoCount || 0) + 1;
    }
  });
}
