'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import type { UserProfile, AuthClaims, UserRole } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  claims: AuthClaims | null;
  loading: boolean;
  orgId: string | null;
  role: UserRole | null;
  isSuperAdmin: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  registerWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [claims, setClaims] = useState<AuthClaims | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        // Get custom claims from ID token
        const idTokenResult = await firebaseUser.getIdTokenResult(true);
        const tokenClaims = idTokenResult.claims as AuthClaims;
        setClaims(tokenClaims);

        // Load user profile from Firestore
        const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (profileDoc.exists()) {
          setProfile(profileDoc.data() as UserProfile);
        }
      } else {
        setClaims(null);
        setProfile(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setClaims(null);
  };

  const registerWithEmail = async (
    email: string,
    password: string,
    displayName: string,
  ) => {
    const { user: newUser } = await createUserWithEmailAndPassword(auth, email, password);

    // Create user profile in Firestore
    await setDoc(doc(db, 'users', newUser.uid), {
      uid: newUser.uid,
      display_name: displayName,
      email,
      photo_url: null,
      org_memberships: [],
      created_at: serverTimestamp(),
    });
  };

  const value: AuthContextValue = {
    user,
    profile,
    claims,
    loading,
    orgId: claims?.orgId ?? null,
    role: claims?.role ?? null,
    isSuperAdmin: claims?.role === 'super_admin',
    signInWithEmail,
    signInWithGoogle,
    signOut,
    registerWithEmail,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
