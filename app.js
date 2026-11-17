// Import SDK Firebase từ CDN chính thức
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  getDocs,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ================= CẤU HÌNH FIREBASE CỦA BẠN =================
// HÃY DÁN CONFIG CỦA PROJECT dinoconnect-5416e VÀO ĐÂY
const firebaseConfig = {
  apiKey: "AIzaSyDQgupPsPKuncLRjTPaA-tm5QYwtff2diM",
  authDomain: "dinoconnect-5416e.firebaseapp.com",
  databaseURL: "https://dinoconnect-5416e-default-rtdb.firebaseio.com",
  projectId: "dinoconnect-5416e",
  storageBucket: "dinoconnect-5416e.firebasestorage.app",
  messagingSenderId: "531111213542",
  appId: "1:531111213542:web:f001bcf76075ca2d95be27"
}

// Khởi tạo Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUserData = null;
let activeChatUserId = null;
let selectedPostImageBase64 = "";
let allUsersCache = [];

// Hàm hỗ trợ nén ảnh sang Base64 nhẹ để lưu thẳng Firestore (miễn phí 100%)
function compressImageToBase64(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

// ================= 1. XỬ LÝ AUTH & TRẠNG THÁI ONLINE =================
window.toggleAuth = function (mode) {
  document.getElementById('login-form').classList.toggle('active', mode === 'login');
  document.getElementById('register-form').classList.toggle('active', mode === 'register');
}

window.handleRegister = async function (e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    const customUID = '#DN' + Math.floor(1000 + Math.random() * 9000);

    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      name: name,
      email: email,
      customUID: customUID,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`,
      bio: "Xin chào! Tôi đang sử dụng DinoConnect.",
      isOnline: true
    });

    alert('Đăng ký thành công!');
  } catch (error) {
    alert('Lỗi đăng ký: ' + error.message);
  }
}

window.handleLogin = async function (e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    alert('Đăng nhập thất bại: ' + error.message);
  }
}

window.handleLogout = async function () {
  if (auth.currentUser) {
    await setDoc(doc(db, "users", auth.currentUser.uid), { isOnline: false }, { merge: true });
  }
  await signOut(auth);
}

// Cập nhật trạng thái Offline khi đóng tab trình duyệt
window.addEventListener('beforeunload', () => {
  if (auth.currentUser) {
    setDoc(doc(db, "users", auth.currentUser.uid), { isOnline: false }, { merge: true });
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');

    // Đánh dấu đang Online
    await setDoc(doc(db, "users", user.uid), { isOnline: true }, { merge: true });

    await loadUserData(user.uid);
    loadFeedPosts();
    listenAllUsersRealtime();
  } else {
    document.getElementById('app-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
  }
});

// ================= 2. QUẢN LÝ HỒ SƠ & UID =================
async function loadUserData(uid) {
  const docRef = doc(db, "users", uid);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    currentUserData = docSnap.data();

    document.getElementById('display-name').innerText = currentUserData.name || "Người dùng";
    document.getElementById('my-uid').innerText = currentUserData.customUID || "#DN0000";
    document.getElementById('display-bio').innerText = currentUserData.bio || "";

    const avatarUrl = currentUserData.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}`;
    document.getElementById('profile-avatar-preview').src = avatarUrl;
    document.getElementById('header-avatar').src = avatarUrl;
    document.getElementById('create-post-avatar').src = avatarUrl;

    document.getElementById('edit-name').value = currentUserData.name || "";
    document.getElementById('edit-avatar').value = avatarUrl;
    document.getElementById('edit-bio').value = currentUserData.bio || "";
  }
}

window.saveProfile = async function (e) {
  e.preventDefault();
  if (!auth.currentUser) return;

  const newName = document.getElementById('edit-name').value;
  const newAvatar = document.getElementById('edit-avatar').value;
  const newBio = document.getElementById('edit-bio').value;
  const currentUID = document.getElementById('my-uid').innerText;

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);
    await setDoc(userRef, {
      uid: auth.currentUser.uid,
      email: auth.currentUser.email,
      name: newName,
      avatar: newAvatar,
      bio: newBio,
      isOnline: true,
      customUID: currentUID === '#------' ? '#DN' + Math.floor(1000 + Math.random() * 9000) : currentUID
    }, { merge: true });

    alert('Cập nhật hồ sơ thành công!');
    loadUserData(auth.currentUser.uid);
  } catch (error) {
    alert('Lỗi cập nhật: ' + error.message);
  }
}

window.copyUID = function () {
  const uid = document.getElementById('my-uid').innerText;
  navigator.clipboard.writeText(uid);
  alert('Đã sao chép mã: ' + uid);
}

// ================= 3. MẠNG XÃ HỘI (ĐĂNG BÀI, ẢNH, LIKE, BÌNH LUẬN, XÓA) =================
window.previewPostImage = async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    selectedPostImageBase64 = await compressImageToBase64(file, 800, 0.7);
    document.getElementById('post-image-preview').src = selectedPostImageBase64;
    document.getElementById('post-image-preview-box').classList.remove('hidden');
  } catch (err) {
    alert("Không thể đọc ảnh này!");
  }
}

window.clearPostImage = function () {
  selectedPostImageBase64 = "";
  document.getElementById('post-image-file').value = "";
  document.getElementById('post-image-preview-box').classList.add('hidden');
}

window.createPost = async function () {
  const content = document.getElementById('post-content').value.trim();
  if (!content && !selectedPostImageBase64) return;

  const btn = document.getElementById('btn-submit-post');
  btn.disabled = true;
  btn.innerText = "Đang đăng...";

  try {
    await addDoc(collection(db, "posts"), {
      authorId: auth.currentUser.uid,
      authorName: currentUserData?.name || "Người dùng",
      authorUID: currentUserData?.customUID || "#DN0000",
      authorAvatar: currentUserData?.avatar || "https://api.dicebear.com/7.x/avataaars/svg?seed=User",
      content: content,
      imageUrl: selectedPostImageBase64,
      likes: [],
      comments: [],
      createdAt: serverTimestamp()
    });

    document.getElementById('post-content').value = '';
    clearPostImage();
  } catch (error) {
    alert('Lỗi đăng bài: ' + error.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Đăng bài";
  }
}

// Thả tim / Bỏ tim bài viết
window.toggleLikePost = async function (postId, isLiked) {
  const postRef = doc(db, "posts", postId);
  try {
    if (isLiked) {
      await updateDoc(postRef, { likes: arrayRemove(auth.currentUser.uid) });
    } else {
      await updateDoc(postRef, { likes: arrayUnion(auth.currentUser.uid) });
    }
  } catch (err) {
    console.error("Lỗi like:", err);
  }
}

// Gửi bình luận bài viết
window.addCommentPost = async function (e, postId) {
  e.preventDefault();
  const input = document.getElementById(`comment-input-${postId}`);
  const text = input.value.trim();
  if (!text) return;

  const postRef = doc(db, "posts", postId);
  try {
    await updateDoc(postRef, {
      comments: arrayUnion({
        userName: currentUserData?.name || "Người dùng",
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })
    });
    input.value = '';
  } catch (err) {
    alert("Lỗi gửi bình luận: " + err.message);
  }
}

// Xóa bài viết của chính mình
window.deletePost = async function (postId) {
  if (!confirm("Bạn có chắc muốn xóa bài viết này không?")) return;
  try {
    await deleteDoc(doc(db, "posts", postId));
  } catch (err) {
    alert("Lỗi xóa bài: " + err.message);
  }
}

function loadFeedPosts() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snapshot) => {
    const feedList = document.getElementById('feed-list');
    feedList.innerHTML = '';

    snapshot.forEach((docSnap) => {
      const post = docSnap.data();
      const postId = docSnap.id;
      const isMyPost = post.authorId === auth.currentUser?.uid;

      // Xử lý lượt thích
      const likesList = post.likes || [];
      const isLiked = likesList.includes(auth.currentUser?.uid);
      const likeCount = likesList.length;

      // Xử lý bình luận
      const commentsList = post.comments || [];
      const commentsHtml = commentsList.map(c => `
        <div class="comment-item">
          <strong>${c.userName}:</strong> ${c.text}
        </div>
      `).join('');

      const timeStr = post.createdAt
        ? new Date(post.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : "Vừa xong";

      let mediaHtml = post.imageUrl ? `
        <div class="post-media">
          <img src="${post.imageUrl}" alt="Post image">
        </div>
      ` : '';

      const html = `
        <article class="post-card">
          <div class="post-header">
            <img src="${post.authorAvatar}" alt="Avatar">
            <div class="post-user-info">
              <h4>${post.authorName} <span class="user-uid">${post.authorUID}</span></h4>
              <small>${timeStr}</small>
            </div>
            ${!isMyPost ? `
              <button class="btn-post-action" onclick="openChatWithUser('${post.authorId}', '${post.authorName}', '${post.authorUID}', '${post.authorAvatar}')" title="Nhắn tin">
                <i class="fa-regular fa-paper-plane"></i>
              </button>` : `
              <button class="btn-post-action btn-delete-post" onclick="deletePost('${postId}')" title="Xóa bài viết">
                <i class="fa-regular fa-trash-can"></i>
              </button>`}
          </div>
          
          ${post.content ? `<p class="post-text">${post.content}</p>` : ''}
          ${mediaHtml}
          
          <div class="post-actions">
            <button class="${isLiked ? 'liked' : ''}" onclick="toggleLikePost('${postId}', ${isLiked})">
              <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i> ${likeCount > 0 ? likeCount : ''} Thích
            </button>
            <button onclick="document.getElementById('comment-input-${postId}').focus()">
              <i class="fa-regular fa-comment"></i> ${commentsList.length > 0 ? commentsList.length : ''} Bình luận
            </button>
          </div>

          <div class="comments-section">
            <div class="comment-list">${commentsHtml}</div>
            <form class="comment-form" onsubmit="addCommentPost(event, '${postId}')">
              <input type="text" id="comment-input-${postId}" placeholder="Viết bình luận..." autocomplete="off">
              <button type="submit">Gửi</button>
            </form>
          </div>
        </article>
      `;
      feedList.insertAdjacentHTML('beforeend', html);
    });
  });
}

// ================= 4. TÌM KIẾM & NHẮN TIN THỜI GIAN THỰC =================
function listenAllUsersRealtime() {
  onSnapshot(collection(db, "users"), (snapshot) => {
    allUsersCache = [];
    const chatListContainer = document.getElementById('chat-list-container');
    chatListContainer.innerHTML = '';

    snapshot.forEach((docSnap) => {
      const u = docSnap.data();
      allUsersCache.push(u);

      if (u.uid === auth.currentUser?.uid) return;

      // Cập nhật trạng thái nếu đang mở khung chat với người này
      if (activeChatUserId === u.uid) {
        updateChatHeaderStatus(u.customUID, u.isOnline);
      }

      const html = `
        <div class="chat-item ${activeChatUserId === u.uid ? 'active' : ''}" onclick="openChatWithUser('${u.uid}', '${u.name}', '${u.customUID}', '${u.avatar}')">
          <div class="avatar-status-wrap">
            <img src="${u.avatar}" alt="Avatar">
            <span class="status-dot ${u.isOnline ? 'online' : ''}"></span>
          </div>
          <div class="chat-item-info">
            <div class="chat-item-top">
              <h4>${u.name}</h4>
              <span>${u.customUID}</span>
            </div>
            <p>${u.isOnline ? '🟢 Đang hoạt động' : u.bio}</p>
          </div>
        </div>
      `;
      chatListContainer.insertAdjacentHTML('beforeend', html);
    });
  });
}

// Tìm kiếm người dùng theo Tên hoặc Mã UID
window.searchUsers = function (keyword) {
  keyword = keyword.trim().toLowerCase();
  const resultsBox = document.getElementById('search-results');

  if (!keyword) {
    resultsBox.classList.add('hidden');
    return;
  }

  const matched = allUsersCache.filter(u =>
    u.uid !== auth.currentUser?.uid &&
    (u.name?.toLowerCase().includes(keyword) || u.customUID?.toLowerCase().includes(keyword))
  );

  if (matched.length === 0) {
    resultsBox.innerHTML = `<div style="padding:12px; color:var(--text-muted); font-size:13px;">Không tìm thấy người dùng nào</div>`;
  } else {
    resultsBox.innerHTML = matched.map(u => `
      <div class="search-result-item" onclick="selectSearchUser('${u.uid}', '${u.name}', '${u.customUID}', '${u.avatar}')">
        <img src="${u.avatar}" alt="Avatar">
        <div>
          <h5>${u.name}</h5>
          <span>${u.customUID} • ${u.isOnline ? 'Đang hoạt động' : 'Ngoại tuyến'}</span>
        </div>
      </div>
    `).join('');
  }
  resultsBox.classList.remove('hidden');
}

window.selectSearchUser = function (uid, name, customUID, avatar) {
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('user-search-input').value = '';
  openChatWithUser(uid, name, customUID, avatar);
}

function updateChatHeaderStatus(customUID, isOnline) {
  const statusEl = document.getElementById('chat-partner-uid');
  const dotEl = document.getElementById('chat-partner-dot');
  if (isOnline) {
    statusEl.innerText = `${customUID} • Đang hoạt động`;
    statusEl.classList.add('online-text');
    dotEl.classList.add('online');
  } else {
    statusEl.innerText = `${customUID} • Ngoại tuyến`;
    statusEl.classList.remove('online-text');
    dotEl.classList.remove('online');
  }
}

window.openChatWithUser = function (partnerId, partnerName, partnerUID, partnerAvatar) {
  switchTab('chat');
  activeChatUserId = partnerId;

  const partnerObj = allUsersCache.find(u => u.uid === partnerId);
  document.getElementById('chat-partner-name').innerText = partnerName;
  document.getElementById('chat-partner-avatar').src = partnerAvatar;
  updateChatHeaderStatus(partnerUID, partnerObj?.isOnline || false);

  document.getElementById('chat-window').classList.add('mobile-open');
  loadMessages(partnerId);
}

function getChatRoomId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

window.sendChatMessage = async function (e) {
  e.preventDefault();
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || !activeChatUserId) return;

  const roomId = getChatRoomId(auth.currentUser.uid, activeChatUserId);

  try {
    await addDoc(collection(db, "chats", roomId, "messages"), {
      senderId: auth.currentUser.uid,
      text: text,
      imageUrl: "",
      createdAt: serverTimestamp()
    });
    input.value = '';
  } catch (error) {
    alert('Không thể gửi tin nhắn: ' + error.message);
  }
}

// Gửi hình ảnh trực tiếp trong khung chat
window.sendChatImage = async function (e) {
  const file = e.target.files[0];
  if (!file || !activeChatUserId) return;

  const roomId = getChatRoomId(auth.currentUser.uid, activeChatUserId);
  try {
    const base64Img = await compressImageToBase64(file, 600, 0.7);
    await addDoc(collection(db, "chats", roomId, "messages"), {
      senderId: auth.currentUser.uid,
      text: "",
      imageUrl: base64Img,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    alert("Lỗi gửi ảnh: " + error.message);
  } finally {
    e.target.value = "";
  }
}

function loadMessages(partnerId) {
  const roomId = getChatRoomId(auth.currentUser.uid, partnerId);
  const q = query(collection(db, "chats", roomId, "messages"), orderBy("createdAt", "asc"));

  onSnapshot(q, (snapshot) => {
    const msgBox = document.getElementById('chat-messages');
    msgBox.innerHTML = '';

    snapshot.forEach((docSnap) => {
      const msg = docSnap.data();
      const isSent = msg.senderId === auth.currentUser.uid;
      const div = document.createElement('div');
      div.className = `msg ${isSent ? 'sent' : 'received'}`;

      const imgTag = msg.imageUrl ? `<img class="chat-img" src="${msg.imageUrl}" alt="Hình ảnh">` : '';
      const textTag = msg.text ? `<p>${msg.text}</p>` : '';

      div.innerHTML = `
        ${textTag}
        ${imgTag}
        <span>${msg.createdAt ? new Date(msg.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Đang gửi...'}</span>
      `;
      msgBox.appendChild(div);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  });
}

// ================= HỆ THỐNG ĐIỀU HƯỚNG TAB =================
window.switchTab = function (tabName, btnElement) {
  document.querySelectorAll('.tab-section').forEach(sec => sec.classList.remove('active'));
  document.getElementById('tab-' + tabName).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) {
    btnElement.classList.add('active');
  } else {
    const targetBtn = document.querySelector(`.nav-btn[data-target="tab-${tabName}"]`);
    if (targetBtn) targetBtn.classList.add('active');
  }
}

window.closeMobileChat = function () {
  document.getElementById('chat-window').classList.remove('mobile-open');
}