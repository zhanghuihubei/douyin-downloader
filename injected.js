// Injected Script - 在页面上下文中运行，可以访问抖音的API

(function() {
  'use strict';
  
  console.log('抖音下载器注入脚本已加载');
  
  // 全局变量存储当前的XMLHttpRequest，用于中断
  let currentXhr = null;
  
  // 监听来自content script的消息
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data.type || event.data.type !== 'TO_DOUYIN_PAGE') return;
    
    const { action, userId, videoUrl, filename, abortSignal } = event.data;
    
    if (action === 'getFollowingList') {
      await getFollowingList();
    }
    
    if (action === 'getUserVideos') {
      await getUserVideos(userId);
    }
    
    if (action === 'downloadVideo') {
      console.log('📥 Injected script收到下载请求:', filename);
      console.log('🚦 中断信号状态:', abortSignal || 'none');
      await downloadVideoInPage(videoUrl, filename, abortSignal);
    }
    
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
  });
  
  // 获取当前用户的关注列表
  async function getFollowingList() {
    try {
      // 尝试从页面获取当前用户ID
      const userInfo = await getCurrentUserInfo();
      if (!userInfo) {
        throw new Error('无法获取当前用户信息，请确保已登录');
      }
      
      console.log('当前用户:', userInfo.nickname, 'uid:', userInfo.uid, 'sec_uid:', userInfo.sec_uid);
      
      const allFollowing = [];
      let cursor = 0;
      let hasMore = true;
      
      while (hasMore) {
        // 使用正确的API端点
        const apiUrl = `https://www-hj.douyin.com/aweme/v1/web/user/following/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&user_id=${userInfo.uid}&sec_user_id=${userInfo.sec_uid}&offset=${cursor}&min_time=0&max_time=0&count=20&source_type=4&gps_access=0&address_book_access=0&is_top=1`;
        
        console.log('获取关注列表 API:', apiUrl);
        
        const response = await fetch(apiUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'accept': 'application/json',
            'referer': 'https://www.douyin.com/'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP错误: ${response.status}`);
        }
        
        const data = await response.json();
        console.log('关注列表API响应:', data);
        
        if (data.followings && data.followings.length > 0) {
          console.log('本次获取', data.followings.length, '个关注用户');
          for (const user of data.followings) {
            allFollowing.push({
              uid: user.sec_uid || user.uid, // 优先使用sec_uid
              sec_uid: user.sec_uid,
              nickname: user.nickname,
              avatar: user.avatar_thumb?.url_list?.[0] || ''
            });
          }
          cursor += data.followings.length; // offset 增加
        } else {
          console.log('本次未获取到关注用户');
        }
        
        hasMore = data.has_more === 1 || data.has_more === true;
        if (!hasMore) {
          console.log('关注列表获取完成');
        } else {
          console.log('继续获取，offset:', cursor);
          // 避免请求过快 - 随机等待2-4秒
          const delay = getRandomDelay(2000, 4000);
          console.log(`⏱️ 等待 ${(delay/1000).toFixed(1)} 秒后继续获取...`);
          await sleep(delay);
        }
      }
      
      console.log('获取关注列表完成，共', allFollowing.length, '个用户');
      
      // 发送给content script
      window.postMessage({
        type: 'FROM_DOUYIN_PAGE',
        action: 'followingList',
        data: allFollowing
      }, '*');
      
    } catch (error) {
      console.error('获取关注列表失败:', error);
      window.postMessage({
        type: 'FROM_DOUYIN_PAGE',
        action: 'error',
        data: error.message
      }, '*');
    }
  }
  
  // 获取指定用户的视频列表
  async function getUserVideos(userId) {
    console.log('=== 获取用户视频 ===');
    console.log('用户ID(sec_uid):', userId);
    try {
      const allVideos = [];
      let cursor = 0;
      let hasMore = true;
      let maxVideos = 50; // 每个用户最多获取50个视频
      let count = 0;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (hasMore && count < maxVideos) {
        // 获取页面参数
        const params = getPageParams();
        
        // 构建URL - 使用用户主页方式
        const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web&sec_user_id=${userId}&max_cursor=${cursor}&locate_query=false&show_live_replay_strategy=1&count=18&publish_video_strategy_type=2&pc_client_type=1&version_code=290100&version_name=29.1.0&cookie_enabled=true&platform=PC&downlink=10&effective_type=4g&round_trip_time=50&webid=${params.webid || ''}&msToken=${params.msToken || ''}&verifyFp=${params.verifyFp || ''}&fp=${params.fp || ''}`;
        console.log('请求视频列表:', apiUrl);
        
        let response;
        let data;
        let attempt = 0;
        const maxAttempts = 2;
        
        // 重试逻辑
        while (attempt < maxAttempts) {
          try {
            attempt++;
            console.log(`尝试 ${attempt}/${maxAttempts} 请求API...`);
            
            response = await fetch(apiUrl, {
              method: 'GET',
              credentials: 'include',
              headers: {
                'accept': 'application/json',
                'referer': 'https://www.douyin.com/',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            if (response.ok) {
              data = await response.json();
              console.log('API响应成功');
              break; // 成功获取响应，跳出重试循环
            } else {
              console.warn(`API请求失败 (尝试 ${attempt}/${maxAttempts}): HTTP ${response.status}`);
              if (attempt < maxAttempts) {
                const retryDelay = getRandomDelay(1000, 3000);
                console.log(`⏱️ 等待 ${retryDelay}ms 后重试...`);
                await sleep(retryDelay);
              }
            }
          } catch (fetchError) {
            console.error(`网络请求失败 (尝试 ${attempt}/${maxAttempts}):`, fetchError.message);
            if (attempt < maxAttempts) {
              const retryDelay = getRandomDelay(2000, 5000);
              console.log(`⏱️ 等待 ${retryDelay}ms 后重试...`);
              await sleep(retryDelay);
            }
          }
        }
        
        if (!data) {
          console.error('❌ 所有API请求尝试都失败了');
          
          // 如果API完全失败，尝试从用户主页获取
          const pageVideos = await getVideosFromUserPage(userId);
          if (pageVideos && pageVideos.length > 0) {
            console.log('✅ 从用户主页获取到', pageVideos.length, '个视频');
            allVideos.push(...pageVideos);
            break; // 从主页只能获取一页，退出循环
          } else {
            console.warn('❌ API和主页都无法获取视频');
            break;
          }
        }
        
        // 检查API是否返回有效数据
        const hasValidData = data.aweme_list && data.aweme_list.length > 0;
        const hasError = data.status_code && data.status_code !== 0;
        
        // 如果API返回错误或空列表，尝试直接访问用户主页获取
        if (hasError || !hasValidData) {
          if (hasError) {
            console.log('API返回错误 status_code:', data.status_code, '尝试从用户主页获取');
          } else {
            console.log('API返回空列表，尝试从用户主页获取');
          }
          
          const pageVideos = await getVideosFromUserPage(userId);
          if (pageVideos && pageVideos.length > 0) {
            console.log('✅ 从用户主页获取到', pageVideos.length, '个视频');
            allVideos.push(...pageVideos);
            break; // 从主页只能获取一页，退出循环
          } else {
            console.warn('❌ 无法从API和主页获取视频');
            break;
          }
        }
        
        // 处理从API获取的视频列表
        if (hasValidData) {
          console.log('获取到', data.aweme_list.length, '个视频');
          for (const aweme of data.aweme_list) {
            // 提取视频信息
            const videoInfo = extractVideoInfo(aweme);
            if (videoInfo) {
              allVideos.push(videoInfo);
              count++;
              console.log('提取视频:', videoInfo.title);
              if (count >= maxVideos) break;
            } else {
              console.warn('无法提取视频信息:', aweme.aweme_id);
            }
          }
        }
        
        hasMore = data.has_more === 1;
        if (hasMore && data.max_cursor) {
          cursor = data.max_cursor;
        } else {
          hasMore = false;
        }
        
        // 避免请求过快 - 随机等待2-4秒
        if (hasMore) {
          const delay = getRandomDelay(2000, 4000);
          console.log(`⏱️ 等待 ${(delay/1000).toFixed(1)} 秒后继续获取...`);
          await sleep(delay);
        }
      }
      
      if (allVideos.length > 0) {
        const author = allVideos[0].author;
        console.log('获取用户视频完成:', author, allVideos.length, '个视频');
        
        // 发送给content script
        window.postMessage({
          type: 'FROM_DOUYIN_PAGE',
          action: 'userVideos',
          data: {
            userId,
            author,
            videos: allVideos
          }
        }, '*');
      }
      
    } catch (error) {
      console.error('获取用户视频失败:', userId, error);
      window.postMessage({
        type: 'FROM_DOUYIN_PAGE',
        action: 'error',
        data: `获取用户${userId}视频失败: ${error.message}` 
      }, '*');
    }
  }
  
  // 提取视频信息
  function extractVideoInfo(aweme) {
    try {
      // 获取视频URL - 尝试多种可能的字段
      let videoUrl = null;
      let urlSource = '';
      
      // 优先级：play_addr > download_addr > bit_rate[0]
      if (aweme.video?.play_addr?.url_list?.length > 0) {
        videoUrl = aweme.video.play_addr.url_list[0];
        urlSource = 'play_addr';
      } else if (aweme.video?.download_addr?.url_list?.length > 0) {
        videoUrl = aweme.video.download_addr.url_list[0];
        urlSource = 'download_addr';
      } else if (aweme.video?.bit_rate?.length > 0) {
        // 尝试从bit_rate获取（有些视频使用这个字段）
        const bitRate = aweme.video.bit_rate[0];
        if (bitRate?.play_addr?.url_list?.length > 0) {
          videoUrl = bitRate.play_addr.url_list[0];
          urlSource = 'bit_rate.play_addr';
        }
      }
      
      // 如果还是没有，尝试从动态URL生成
      if (!videoUrl && aweme.video?.play_addr_h264?.url_list?.length > 0) {
        videoUrl = aweme.video.play_addr_h264.url_list[0];
        urlSource = 'play_addr_h264';
      }
      
      // 尝试从play_addr_265获取
      if (!videoUrl && aweme.video?.play_addr_265?.url_list?.length > 0) {
        videoUrl = aweme.video.play_addr_265.url_list[0];
        urlSource = 'play_addr_265';
      }
      
      if (!videoUrl) {
        console.warn('⚠️ 无法获取视频URL:', aweme.aweme_id);
        console.warn('视频对象结构:', JSON.stringify(aweme.video, null, 2));
        return null;
      }
      
      console.log('✅ 提取视频URL (来源:', urlSource + '):', videoUrl.substring(0, 100) + '...');
      
      return {
        awemeId: aweme.aweme_id,
        title: aweme.desc || '无标题',
        author: aweme.author?.nickname || '未知作者',
        userId: aweme.author?.uid || aweme.author?.sec_uid || 'unknown',
        videoUrl: videoUrl,
        coverUrl: aweme.video?.cover?.url_list?.[0] || '',
        duration: aweme.video?.duration || 0,
        createTime: aweme.create_time || 0
      };
    } catch (error) {
      console.error('提取视频信息失败:', error);
      return null;
    }
  }
  
  // 获取当前登录用户信息
  async function getCurrentUserInfo() {
    console.log('=== 获取用户信息 ===');
    try {
      // 方法1: 从页面的各种window对象获取
      console.log('尝试方法1: 从window对象获取');
      
      // 检查多个可能的位置
      const possiblePaths = [
        () => window.__INIT_PROPS__?.userInfo,
        () => window.__INITIAL_STATE__?.user?.userInfo,
        () => window.RENDER_DATA?.user,
        () => window._ROUTER_DATA?.loaderData?.user,
      ];
      
      for (const getter of possiblePaths) {
        try {
          const userInfo = getter();
          if (userInfo?.uid) {
            console.log('✓ 从window对象找到用户信息:', userInfo.nickname);
            return {
              uid: userInfo.uid,
              sec_uid: userInfo.sec_uid || userInfo.secUid,
              nickname: userInfo.nickname || userInfo.nick_name
            };
          }
        } catch (e) {}
      }
      
      // 方法2: 使用抖音的自我信息API
      console.log('尝试方法2: 调用自我信息API');
      try {
        const response = await fetch('https://www.douyin.com/aweme/v1/web/query/user/', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'accept': 'application/json',
            'referer': 'https://www.douyin.com/'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('API响应:', data);
          if (data.user) {
            console.log('✓ 从API找到用户信息:', data.user.nickname);
            return {
              uid: data.user.uid,
              sec_uid: data.user.sec_uid,
              nickname: data.user.nickname
            };
          }
        }
      } catch (e) {
        console.log('API调用失败:', e.message);
      }
      
      // 方法3: 从SSR数据中获取
      console.log('尝试方法3: 从SSR数据获取');
      const ssrDataScript = document.querySelector('#RENDER_DATA');
      if (ssrDataScript) {
        try {
          const ssrData = JSON.parse(decodeURIComponent(ssrDataScript.textContent));
          console.log('SSR完整数据:', JSON.stringify(ssrData, null, 2));
          
          // 深度搜索用户信息
          function findUserInfo(obj, depth = 0, path = '') {
            if (depth > 8) return null;
            if (!obj || typeof obj !== 'object') return null;
            
            // 检查当前对象是否包含用户信息（数字ID）
            if (obj.uid && typeof obj.uid === 'string' && obj.uid.match(/^\d{10,}$/)) {
              console.log('✓ 在路径找到用户:', path, obj);
              return obj;
            }
            
            // 递归搜索所有字段
            for (const key in obj) {
              const newPath = path ? `${path}.${key}` : key;
              const result = findUserInfo(obj[key], depth + 1, newPath);
              if (result) return result;
            }
            return null;
          }
          
          const user = findUserInfo(ssrData);
          if (user?.uid) {
            console.log('✓ 从SSR数据找到用户信息:', user.nickname, user.uid);
            return {
              uid: user.uid,
              sec_uid: user.sec_uid || user.secUid,
              nickname: user.nickname || user.nick_name || '当前用户'
            };
          }
        } catch (e) {
          console.log('解析SSR数据失败:', e.message);
        }
      }
      
      // 方法4: 从localStorage/sessionStorage获取
      console.log('尝试方法4: 从Storage获取');
      try {
        const storageKeys = Object.keys(localStorage);
        for (const key of storageKeys) {
          try {
            const value = localStorage.getItem(key);
            if (value && value.includes('uid')) {
              const parsed = JSON.parse(value);
              if (parsed.uid && String(parsed.uid).match(/^\d{10,}$/)) {
                console.log('✓ 从localStorage找到用户:', key, parsed.uid);
                return {
                  uid: String(parsed.uid),
                  sec_uid: parsed.sec_uid || parsed.secUid,
                  nickname: parsed.nickname || parsed.nick_name || '当前用户'
                };
              }
            }
          } catch (e) {}
        }
      } catch (e) {
        console.log('Storage读取失败:', e.message);
      }
      
      // 方法5: 从用户头像/菜单元素获取
      console.log('尝试方法5: 从页面元素获取');
      const avatarLink = document.querySelector('[data-e2e="user-info"], .avatar-component, a[href*="/user/"]');
      if (avatarLink) {
        const href = avatarLink.href || avatarLink.querySelector('a')?.href;
        if (href) {
          const match = href.match(/\/user\/([^/?]+)/);
          if (match) {
            const sec_uid = match[1];
            console.log('✓ 从页面元素找到sec_uid:', sec_uid);
            
            // 尝试通过sec_uid获取完整信息
            try {
              const response = await fetch(`https://www.douyin.com/aweme/v1/web/im/user/info/?sec_user_id=${sec_uid}`, {
                credentials: 'include'
              });
              if (response.ok) {
                const data = await response.json();
                if (data.user_info) {
                  console.log('✓ 通过sec_uid获取到完整信息');
                  return {
                    uid: data.user_info.uid,
                    sec_uid: sec_uid,
                    nickname: data.user_info.nickname
                  };
                }
              }
            } catch (e) {}
            
            // 如果无法获取完整信息，至少返回sec_uid
            return {
              sec_uid: sec_uid,
              uid: sec_uid, // 使用sec_uid作为备用
              nickname: '当前用户'
            };
          }
        }
      }
      
      console.error('❌ 所有方法都失败了');
      return null;
    } catch (error) {
      console.error('获取用户信息失败:', error);
      return null;
    }
  }
  
  // 从用户主页获取视频（备用方案）
  async function getVideosFromUserPage(userId) {
    try {
      console.log('尝试从用户主页获取视频:', userId);
      
      // 获取用户主页HTML
      const userPageUrl = `https://www.douyin.com/user/${userId}`;
      const response = await fetch(userPageUrl, {
        credentials: 'include',
        headers: {
          'accept': 'text/html',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      if (!response.ok) {
        console.error('无法获取用户主页:', response.status);
        return null;
      }
      
      const html = await response.text();
      
      // 尝试多种方式提取数据
      let ssrData = null;
      
      // 方法1: 从RENDER_DATA提取
      const renderDataMatch = html.match(/<script id="RENDER_DATA" type="application\/json">(.+?)<\/script>/);
      if (renderDataMatch) {
        try {
          ssrData = JSON.parse(decodeURIComponent(renderDataMatch[1]));
          console.log('从RENDER_DATA提取到SSR数据');
        } catch (e) {
          console.warn('RENDER_DATA解析失败:', e.message);
        }
      }
      
      // 方法2: 从__INITIAL_STATE__提取
      if (!ssrData) {
        const initialStateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s);
        if (initialStateMatch) {
          try {
            ssrData = JSON.parse(initialStateMatch[1]);
            console.log('从__INITIAL_STATE__提取到数据');
          } catch (e) {
            console.warn('__INITIAL_STATE__解析失败:', e.message);
          }
        }
      }
      
      // 方法3: 从RENDER_DATA（不需要解码）
      if (!ssrData) {
        const renderDataMatch2 = html.match(/<script id="RENDER_DATA" type="application\/json">({.+?})<\/script>/);
        if (renderDataMatch2) {
          try {
            ssrData = JSON.parse(renderDataMatch2[1]);
            console.log('从RENDER_DATA（直接）提取到数据');
          } catch (e) {
            console.warn('RENDER_DATA直接解析失败:', e.message);
          }
        }
      }
      
      if (!ssrData) {
        console.error('未找到任何SSR数据');
        return null;
      }
      
      // 输出SSR数据的顶层结构用于调试
      console.log('🔍 SSR数据顶层keys:', Object.keys(ssrData));
      
      // 从SSR数据中找到视频列表
      const videos = [];
      const foundPaths = []; // 记录找到数据的路径
      
      function findVideos(obj, depth = 0, path = '') {
        if (depth > 20) return; // 增加搜索深度
        if (!obj || typeof obj !== 'object') return;
        
        // 查找包含aweme_list的对象
        if (obj.aweme_list && Array.isArray(obj.aweme_list)) {
          if (obj.aweme_list.length > 0) {
            console.log('✅ 在路径', path, '找到aweme_list，包含', obj.aweme_list.length, '个视频');
            foundPaths.push(path + '.aweme_list');
            for (const aweme of obj.aweme_list) {
              const videoInfo = extractVideoInfo(aweme);
              if (videoInfo) {
                videos.push(videoInfo);
              }
            }
          } else {
            console.log('⚠️ 在路径', path, '找到空的aweme_list');
          }
          return; // 找到aweme_list就停止这个分支
        }
        
        // 查找包含post_list的对象
        if (obj.post_list && Array.isArray(obj.post_list)) {
          if (obj.post_list.length > 0) {
            console.log('✅ 在路径', path, '找到post_list，包含', obj.post_list.length, '个视频');
            foundPaths.push(path + '.post_list');
            for (const aweme of obj.post_list) {
              const videoInfo = extractVideoInfo(aweme);
              if (videoInfo) {
                videos.push(videoInfo);
              }
            }
          } else {
            console.log('⚠️ 在路径', path, '找到空的post_list');
          }
          return;
        }
        
        // 查找可能包含视频的其他字段名
        const videoListKeys = ['awemes', 'videos', 'items', 'data', 'list'];
        for (const key of videoListKeys) {
          if (obj[key] && Array.isArray(obj[key]) && obj[key].length > 0) {
            // 检查数组第一个元素是否像视频对象
            const firstItem = obj[key][0];
            if (firstItem && (firstItem.aweme_id || firstItem.video || firstItem.desc)) {
              console.log('✅ 在路径', path, '找到可能的视频列表字段:', key, '包含', obj[key].length, '个项目');
              foundPaths.push(path + '.' + key);
              for (const item of obj[key]) {
                const videoInfo = extractVideoInfo(item);
                if (videoInfo) {
                  videos.push(videoInfo);
                }
              }
              return;
            }
          }
        }
        
        // 递归搜索
        for (const key in obj) {
          const newPath = path ? `${path}.${key}` : key;
          findVideos(obj[key], depth + 1, newPath);
          if (videos.length > 0) return; // 找到就停止
        }
      }
      
      findVideos(ssrData);
      
      if (videos.length > 0) {
        console.log('✅ 从用户主页共提取到', videos.length, '个视频');
        console.log('📍 数据路径:', foundPaths);
      } else {
        console.warn('⚠️ 在SSR数据中未找到视频列表');
        console.log('🔍 尝试手动检查SSR数据结构:', JSON.stringify(ssrData).substring(0, 500));
      }
      
      return videos;
      
    } catch (error) {
      console.error('从用户主页获取视频失败:', error);
      return null;
    }
  }
  
  // 获取页面参数（webid, msToken等）
  function getPageParams() {
    const params = {};
    
    // 从cookie获取
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [key, value] = cookie.trim().split('=');
      if (key === 'msToken') params.msToken = value;
      if (key === 'ttwid') params.ttwid = value;
      if (key === 's_v_web_id') params.webid = value;
    }
    
    // 从全局变量获取
    if (window.byted_acrawler?.frontierConfig) {
      const config = window.byted_acrawler.frontierConfig;
      if (config.msToken) params.msToken = config.msToken;
      if (config.webid) params.webid = config.webid;
    }
    
    // 尝试从页面script标签获取
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text.includes('verifyFp')) {
          const match = text.match(/verifyFp['"]\s*:\s*['"]([^'"]+)['"]/);
          if (match) params.verifyFp = match[1];
        }
        if (text.includes('msToken')) {
          const match = text.match(/msToken['"]\s*:\s*['"]([^'"]+)['"]/);
          if (match) params.msToken = match[1];
        }
      }
    } catch (e) {}
    
    // 如果没有找到，使用cookie中的设备ID
    if (!params.webid) {
      const webidMatch = document.cookie.match(/s_v_web_id=([^;]+)/);
      if (webidMatch) params.webid = webidMatch[1];
    }
    
    // fp通常和verifyFp相同
    if (params.verifyFp && !params.fp) {
      params.fp = params.verifyFp;
    }
    
    console.log('提取到的页面参数:', params);
    return params;
  }
  
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // 获取随机延迟时间
  function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  
  // 在真正的页面上下文中下载视频（没有CORS限制）
  async function downloadVideoInPage(videoUrl, filename, abortSignal) {
    console.log('🔄 使用XMLHttpRequest下载（绕过fetch hook）...');
    console.log('🔗 URL:', videoUrl);
    console.log('🚦 中断信号:', abortSignal || 'none');
    
    // 如果已经有正在进行的下载，先中断它
    if (currentXhr) {
      console.log('⚠️ 检测到正在进行的下载，先中断...');
      currentXhr.abort();
      currentXhr = null;
    }
    
    try {
      // 使用XMLHttpRequest绕过抖音对fetch的Hook
      const blob = await new Promise((resolve, reject) => {
        currentXhr = new XMLHttpRequest();
        currentXhr.open('GET', videoUrl, true);
        currentXhr.responseType = 'blob';
        
        // 设置必要的请求头以绕过防盗链
        currentXhr.setRequestHeader('Referer', 'https://www.douyin.com/');
        currentXhr.setRequestHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        currentXhr.setRequestHeader('Accept', '*/*');
        
        // 处理中断
        currentXhr.onabort = function() {
          console.log('🛑 XMLHttpRequest被中断');
          currentXhr = null;
          // 使用特殊的错误类型来标识中断
          const abortError = new Error('Download aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        };
        
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
        
        currentXhr.onerror = function() {
          currentXhr = null;
          reject(new Error('网络错误'));
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
          
          if (e.lengthComputable) {
            const percent = ((e.loaded / e.total) * 100).toFixed(1);
            console.log(`📥 下载进度: ${percent}% (${(e.loaded / 1024 / 1024).toFixed(2)}MB / ${(e.total / 1024 / 1024).toFixed(2)}MB)`);
          }
        };
        
        currentXhr.send();
      });
      
      console.log('✅ Blob下载完成，大小:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      console.log('📄 Blob类型:', blob.type);
      
      // 检查blob大小
      if (blob.size < 100000) { // 小于100KB
        console.warn('⚠️ Blob太小，可能不是视频文件');
        const text = await blob.slice(0, 1000).text();
        if (text.includes('<!DOCTYPE') || text.includes('<html')) {
          console.error('❌ Blob内容是HTML页面！');
          console.log('内容预览:', text.substring(0, 500));
          throw new Error('下载的是HTML页面，不是视频');
        }
      }
      
      // 创建blob URL并触发下载
      console.log('💾 创建下载链接...');
      const blobUrl = URL.createObjectURL(blob);
      
      // 创建隐藏的<a>标签
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      
      console.log('🖱️ 触发下载...');
      a.click();
      
      // 清理
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        console.log('🧹 清理完成');
      }, 1000);
      
      console.log('✅ 下载触发成功');
      
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
    } finally {
      // 确保清理currentXhr
      if (currentXhr) {
        currentXhr = null;
      }
    }
  }
  
})();
