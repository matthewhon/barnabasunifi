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
        try {
          const [idTokenResult, profileDoc] = await Promise.all([
            firebaseUser.getIdTokenResult(true),
            getDoc(doc(db, 'users', firebaseUser.uid)),
          ]);
          setClaims(idTokenResult.claims as AuthClaims);
          if (profileDoc.exists()) {
            setProfile(profileDoc.data() as UserProfile);
          } else {
            setProfile(null);
          }
        } catch (err) {
          console.error('Error fetching user auth profile or claims:', err);
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

  const firstProfileOrgId = profile?.org_memberships
    ? (Array.isArray(profile.org_memberships)
        ? profile.org_memberships[0]?.org_id
        : Object.keys(profile.org_memberships)[0])
    : null;

  const activeOrgId = claims?.orgId ?? firstProfileOrgId ?? null;

  const profileRole = (profile as unknown as { role?: UserRole })?.role;
  const isSuper = claims?.role === 'super_admin' || profileRole === 'super_admin';

  const activeRole: UserRole | null =
    claims?.role ??
    (isSuper ? 'super_admin' : null) ??
    (activeOrgId && profile?.org_memberships
      ? (Array.isArray(profile.org_memberships)
          ? (profile.org_memberships as Array<{ org_id: string; role: UserRole }>).find((m) => m.org_id === activeOrgId)?.role
          : (profile.org_memberships as Record<string, { role: UserRole }>)[activeOrgId]?.role)
      : null) ??
    null;

  const value: AuthContextValue = {
    user,
    profile,
    claims,
    loading,
    orgId: activeOrgId,
    role: activeRole,
    isSuperAdmin: isSuper,
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
