# 管理界面测试指南

## 🔍 测试步骤

### 1. **重新加载扩展**
```
1. 打开 chrome://extensions/
2. 找到"抖音关注视频自动下载器"
3. 点击刷新按钮 🔄
```

### 2. **打开管理页面**
```
1. 点击扩展图标
2. 点击"📊 管理用户和视频"按钮
3. 新标签页会打开管理界面
```

### 3. **打开开发者工具**
```
1. 在管理页面按 F12
2. 查看 Console 标签
3. 应该能看到以下日志：
   - 📋 管理页面加载...
   - 🔄 开始加载数据...
   - 📊 获取统计信息...
   - 👥 获取用户列表...
   - 🎬 获取视频列表...
   - ✅ 数据加载完成
```

### 4. **查看后台日志**
```
1. 打开 chrome://extensions/
2. 点击"Service Worker"旁边的"inspect views"链接
3. 查看后台脚本的控制台
4. 应该能看到数据库初始化日志
```

---

## 🐛 调试常见问题

### 问题1: "DouyinDB is not defined"
**原因**: db.js 未正确加载到 Service Worker

**解决方案**:
1. 确认 `importScripts('db.js')` 在 background.js 顶部
2. 确认 db.js 文件存在
3. 重新加载扩展

---

### 问题2: 管理页面空白或无反应
**检查步骤**:

1. **打开控制台查看错误**
   ```
   按 F12 → Console 标签
   ```

2. **检查是否有网络错误**
   ```
   F12 → Network 标签
   看是否有资源加载失败（红色）
   ```

3. **检查 chrome.runtime.sendMessage 是否工作**
   ```javascript
   // 在管理页面控制台输入：
   chrome.runtime.sendMessage({ action: 'getStats' }, console.log)
   ```
   应该能看到返回的统计数据

---

### 问题3: 视频列表为空
**可能原因**:
- 没有下载过视频
- 数据库未初始化
- API 调用失败

**检查方法**:
```javascript
// 在管理页面控制台输入：
chrome.runtime.sendMessage({ 
  action: 'getAllDownloadedVideos' 
}, (response) => {
  console.log('视频数据:', response);
});
```

---

### 问题4: 用户列表为空
**可能原因**:
- 未获取过关注列表
- 数据未保存成功

**解决方案**:
1. 打开抖音网页
2. 点击扩展popup中的"🔍 立即扫描关注列表"
3. 等待扫描完成
4. 刷新管理页面

---

## 🧪 手动测试数据库

### 在后台 Service Worker 控制台测试

```javascript
// 1. 初始化数据库
await DouyinDB.initDB();
console.log('✅ 数据库已初始化');

// 2. 添加测试用户
await DouyinDB.saveUser({
  userId: 'test_user_123',
  nickname: '测试用户',
  avatar: '',
  enabled: true
});
console.log('✅ 测试用户已添加');

// 3. 添加测试视频
await DouyinDB.saveVideo({
  awemeId: 'test_video_123',
  userId: 'test_user_123',
  author: '测试用户',
  title: '测试视频',
  videoUrl: 'https://example.com/video.mp4',
  downloaded: true,
  downloadTime: Date.now()
});
console.log('✅ 测试视频已添加');

// 4. 获取统计信息
const stats = await DouyinDB.getStats();
console.log('📊 统计信息:', stats);

// 5. 获取所有用户
const users = await DouyinDB.getAllUsers();
console.log('👥 用户列表:', users);

// 6. 获取所有视频
const videos = await DouyinDB.getAllDownloadedVideos();
console.log('🎬 视频列表:', videos);
```

---

## 📝 预期输出

### 控制台日志（管理页面）
```
📋 管理页面加载...
🔄 开始加载数据...
📊 获取统计信息...
统计信息响应: {success: true, stats: {...}}
✅ 统计信息已更新
👥 获取用户列表...
用户列表响应: {success: true, users: [...]}
✅ 加载了 X 个用户
🎬 获取视频列表...
视频列表响应: {success: true, videos: [...]}
✅ 加载了 X 个已下载视频
✅ 数据加载完成
✅ 管理页面初始化完成
```

### 控制台日志（后台 Service Worker）
```
✅ 数据库初始化成功
✅ 数据迁移完成
抖音下载器已安装，配置: {autoDownload: true, ...}
后台收到消息: getStats {...}
后台收到消息: getAllUsers {...}
后台收到消息: getAllDownloadedVideos {...}
```

---

## 🎯 功能测试清单

### 用户管理
- [ ] 能看到用户列表
- [ ] 能启用/禁用用户
- [ ] 能查看用户的视频
- [ ] 能删除用户

### 视频管理
- [ ] 能看到已下载视频列表
- [ ] 能看到视频详情（标题、作者、时长等）
- [ ] 能删除视频记录
- [ ] 删除后列表自动刷新

### 统计信息
- [ ] 显示正确的用户总数
- [ ] 显示正确的视频总数
- [ ] 显示正确的已下载数量

### 界面交互
- [ ] 标签切换正常
- [ ] 按钮点击有反应
- [ ] 删除操作有确认提示
- [ ] 操作完成后自动刷新

---

## 💊 快速修复

如果遇到问题，尝试以下操作：

1. **清除扩展数据**
   ```
   chrome://extensions/ 
   → 找到扩展 
   → 点击"详细信息"
   → 滚动到底部
   → 点击"清除存储空间"
   ```

2. **重新安装扩展**
   ```
   1. 移除扩展
   2. 关闭所有抖音标签页
   3. 重新加载扩展
   ```

3. **检查数据库**
   ```
   F12 → Application 标签 → IndexedDB
   → 查看 DouyinDownloaderDB 数据库
   → 检查 users、videos、config 表
   ```

---

## 📞 报告问题

如果问题仍然存在，请提供：
1. 控制台完整错误日志
2. 后台 Service Worker 日志
3. 数据库截图（F12 → Application → IndexedDB）
4. 操作步骤描述
