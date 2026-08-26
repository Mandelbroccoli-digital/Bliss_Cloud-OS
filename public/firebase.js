// Firebase configuration for Bliss-26 Subkernel
// Get your config from: Firebase Console -> Project Settings -> General -> Your apps
// Replace the placeholder values with your actual Firebase config

// Initialize Firebase (using CDN for simplicity in Tauri environment)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, getDocs, query, orderBy, serverTimestamp, addDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// TODO: Replace these with your actual Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyC_fAjAoPsBQzFosU9MdaqG5_vhe-UkhS8",
  authDomain: "mandelbroccoli-iaas-01.firebaseapp.com",
  projectId: "mandelbroccoli-iaas-01",
  storageBucket: "mandelbroccoli-iaas-01.firebasestorage.app",
  messagingSenderId: "240628537865",
  appId: "1:240628537865:web:cde2782ec6c66c9af9f6d8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Auth helpers
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error("Google sign-in error:", error);
    throw error;
  }
};

export const logoutUser = () => signOut(auth);

// Auth state listener
export const onAuthChange = (callback) => onAuthStateChanged(auth, callback);

// Firestore helpers for chat storage
export const saveChatMessage = async (userId, chatId, message, role) => {
  try {
    const messageRef = await addDoc(collection(db, `users/${userId}/chats/${chatId}/messages`), {
      ...message,
      role,
      timestamp: serverTimestamp()
    });
    return messageRef.id;
  } catch (error) {
    console.error("Error saving chat message:", error);
    throw error;
  }
};

export const loadChatMessages = async (userId, chatId) => {
  try {
    const q = query(collection(db, `users/${userId}/chats/${chatId}/messages`), orderBy("timestamp", "asc"));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error loading chat messages:", error);
    throw error;
  }
};

export const updateChatMessage = async (userId, chatId, messageId, updates) => {
  try {
    const messageRef = doc(db, `users/${userId}/chats/${chatId}/messages/${messageId}`);
    await updateDoc(messageRef, updates);
  } catch (error) {
    console.error("Error updating chat message:", error);
    throw error;
  }
};
