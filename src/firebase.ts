/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, User as FirebaseUser, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, getDocs, collection, updateDoc, deleteDoc, query, where, getDocFromServer } from 'firebase/firestore';
import { UserProfile, UserRole, ClassPackage, YogaClass, Booking, BookingStatus, Expense } from './types';
import { INITIAL_CLASSES } from './data/initialSchedule';
import firebaseConfig from '../firebase-applet-config.json';

// Define operation types for standard error tracking
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

// Check if firebase is configured with credentials
const hasFirebaseCredentials = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "";

let app;
let auth: any = null;
let db: any = null;
let isMock = true;

if (hasFirebaseCredentials) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    auth = getAuth(app);
    isMock = false;
    console.log("Firebase initialized successfully in LIVE Mode.");
  } catch (error) {
    console.error("Firebase initialization failed, falling back to Sandbox Mode:", error);
    isMock = true;
  }
} else {
  console.log("No Firebase configuration keys found. Initializing in SANDBOX (LocalStorage) Mode.");
  isMock = true;
}

// Error handling helper as mandated by firebase skill
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || 'anonymous',
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || null,
      isAnonymous: auth?.currentUser?.isAnonymous || null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Ensure the client connection is valid
if (!isMock && db) {
  const testConnection = async () => {
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.warn("Please check your Firebase configuration or internet connection. Client is offline.");
      }
    }
  };
  testConnection();
}

// ==========================================
// LOCAL STORAGE SANDBOX FALLBACK ENGINE
// ==========================================
const LS_KEYS = {
  USERS: 'yoga_studio_users',
  PACKAGES: 'yoga_studio_packages',
  BOOKINGS: 'yoga_studio_bookings',
  ACTIVE_USER: 'yoga_studio_active_user',
};

// Seed LocalStorage with default profiles for testing
const seedLocalStorageIfNeeded = () => {
  if (!localStorage.getItem(LS_KEYS.USERS)) {
    const defaultUsers: Record<string, UserProfile> = {
      'admin_val': {
        userId: 'admin_val',
        email: 'valentina@yoga.com',
        displayName: 'Valentina (Propietaria)',
        role: 'admin',
        createdAt: new Date().toISOString()
      },
      'student_demo': {
        userId: 'student_demo',
        email: 'joaquinvillanuevavarela@gmail.com',
        displayName: 'Joaquín V.',
        role: 'student',
        createdAt: new Date().toISOString()
      }
    };
    localStorage.setItem(LS_KEYS.USERS, JSON.stringify(defaultUsers));
  }

  if (!localStorage.getItem(LS_KEYS.PACKAGES)) {
    const now = new Date();
    const expiry10 = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000);
    const expiry20 = new Date(now.getTime() + 60 * 24 * 60 * 1000);
    const expiryUnl = new Date(now.getTime() + 30 * 24 * 60 * 1000);
    const expiryExpired = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    const defaultPackages: ClassPackage[] = [
      {
        packageId: 'pkg_1',
        studentId: 'student_demo',
        studentName: 'Joaquín V.',
        studentEmail: 'joaquinvillanuevavarela@gmail.com',
        type: '10_classes',
        pricePaid: 50,
        totalClasses: 10,
        remainingClasses: 6,
        purchaseDate: now.toISOString(),
        expiryDate: expiry10.toISOString(),
        status: 'active'
      },
      {
        packageId: 'pkg_2',
        studentId: 'student_lucia',
        studentName: 'Lucía G.',
        studentEmail: 'lucia@gmail.com',
        type: '20_classes',
        pricePaid: 90,
        totalClasses: 20,
        remainingClasses: 2, // Por vencer
        purchaseDate: now.toISOString(),
        expiryDate: expiry20.toISOString(),
        status: 'expiring'
      },
      {
        packageId: 'pkg_3',
        studentId: 'student_mateo',
        studentName: 'Mateo R.',
        studentEmail: 'mateo@gmail.com',
        type: 'unlimited',
        pricePaid: 120,
        totalClasses: 999,
        remainingClasses: 999,
        purchaseDate: now.toISOString(),
        expiryDate: expiryUnl.toISOString(),
        status: 'active'
      },
      {
        packageId: 'pkg_4',
        studentId: 'student_dormant',
        studentName: 'Clara S.',
        studentEmail: 'clara@gmail.com',
        type: '10_classes',
        pricePaid: 50,
        totalClasses: 10,
        remainingClasses: 0, // Dormido (0 clases hace tiempo)
        purchaseDate: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        expiryDate: expiryExpired.toISOString(),
        status: 'dormant'
      },
      {
        packageId: 'pkg_5',
        studentId: 'student_expired',
        studentName: 'Carlos P.',
        studentEmail: 'carlos@gmail.com',
        type: '20_classes',
        pricePaid: 90,
        totalClasses: 20,
        remainingClasses: 12,
        purchaseDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString(),
        expiryDate: expiryExpired.toISOString(),
        status: 'expired'
      }
    ];
    localStorage.setItem(LS_KEYS.PACKAGES, JSON.stringify(defaultPackages));
  }

  if (!localStorage.getItem(LS_KEYS.BOOKINGS)) {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const getFormattedDate = (offsetDays: number) => {
      const d = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    const defaultBookings: Booking[] = [
      // Reservas pasadas (Asistidas) - útil para métricas
      {
        bookingId: 'b_1',
        classId: 'mon_1',
        className: 'Vinyasa Flow',
        instructor: 'Sofía',
        studentId: 'student_demo',
        studentName: 'Joaquín V.',
        studentEmail: 'joaquinvillanuevavarela@gmail.com',
        classDate: getFormattedDate(-2), // Hace 2 días
        classTime: '07:00',
        status: 'attended',
        createdAt: new Date().toISOString()
      },
      {
        bookingId: 'b_2',
        classId: 'mon_2',
        className: 'Hatha Tradicional',
        instructor: 'Matías',
        studentId: 'student_lucia',
        studentName: 'Lucía G.',
        studentEmail: 'lucia@gmail.com',
        classDate: getFormattedDate(-2),
        classTime: '08:30',
        status: 'attended',
        createdAt: new Date().toISOString()
      },
      {
        bookingId: 'b_3',
        classId: 'wed_5',
        className: 'Vinyasa Pro',
        instructor: 'Sofía',
        studentId: 'student_demo',
        studentName: 'Joaquín V.',
        studentEmail: 'joaquinvillanuevavarela@gmail.com',
        classDate: getFormattedDate(-1),
        classTime: '19:00',
        status: 'attended',
        createdAt: new Date().toISOString()
      },
      {
        bookingId: 'b_4',
        classId: 'sat_1',
        className: 'Ashtanga Pro Sábado',
        instructor: 'Camila',
        studentId: 'student_mateo',
        studentName: 'Mateo R.',
        studentEmail: 'mateo@gmail.com',
        classDate: getFormattedDate(-4),
        classTime: '08:30',
        status: 'attended',
        createdAt: new Date().toISOString()
      },
      {
        bookingId: 'b_5',
        classId: 'fri_4',
        className: 'Yin & Sonidos Sagrados',
        instructor: 'Lucas',
        studentId: 'student_mateo',
        studentName: 'Mateo R.',
        studentEmail: 'mateo@gmail.com',
        classDate: getFormattedDate(-5),
        classTime: '17:30',
        status: 'attended',
        createdAt: new Date().toISOString()
      },
      // Reservas Futuras
      {
        bookingId: 'b_6',
        classId: 'thu_2',
        className: 'Ashtanga Pro',
        instructor: 'Camila',
        studentId: 'student_demo',
        studentName: 'Joaquín V.',
        studentEmail: 'joaquinvillanuevavarela@gmail.com',
        classDate: getFormattedDate(1), // Mañana o en un día
        classTime: '08:30',
        status: 'booked',
        createdAt: new Date().toISOString()
      },
      {
        bookingId: 'b_7',
        classId: 'fri_1',
        className: 'Vinyasa Energizante',
        instructor: 'Sofía',
        studentId: 'student_mateo',
        studentName: 'Mateo R.',
        studentEmail: 'mateo@gmail.com',
        classDate: getFormattedDate(2),
        classTime: '07:00',
        status: 'booked',
        createdAt: new Date().toISOString()
      }
    ];
    localStorage.setItem(LS_KEYS.BOOKINGS, JSON.stringify(defaultBookings));
  }

  if (!localStorage.getItem('yoga_studio_expenses')) {
    const defaultExpenses = [
      {
        expenseId: 'exp_1',
        amount: 250000,
        category: 'sueldos',
        description: 'Pago de sueldo instructores de Yoga (Mayo)',
        date: '2026-05-28',
        createdAt: new Date('2026-05-28').toISOString()
      },
      {
        expenseId: 'exp_2',
        amount: 350000,
        category: 'arriendo',
        description: 'Arriendo mensual del salón principal San Miguel (Mayo)',
        date: '2026-05-05',
        createdAt: new Date('2026-05-05').toISOString()
      },
      {
        expenseId: 'exp_3',
        amount: 45000,
        category: 'generales',
        description: 'Gastos de luz, agua e internet (Mayo)',
        date: '2026-05-15',
        createdAt: new Date('2026-05-15').toISOString()
      },
      {
        expenseId: 'exp_4',
        amount: 280000,
        category: 'sueldos',
        description: 'Pago de sueldo instructores de Yoga (Junio)',
        date: '2026-06-25',
        createdAt: new Date('2026-06-25').toISOString()
      },
      {
        expenseId: 'exp_5',
        amount: 350000,
        category: 'arriendo',
        description: 'Arriendo mensual del salón principal San Miguel (Junio)',
        date: '2026-06-05',
        createdAt: new Date('2026-06-05').toISOString()
      },
      {
        expenseId: 'exp_6',
        amount: 52000,
        category: 'generales',
        description: 'Gastos de luz, agua y limpieza sahumerios (Junio)',
        date: '2026-06-10',
        createdAt: new Date('2026-06-10').toISOString()
      }
    ];
    localStorage.setItem('yoga_studio_expenses', JSON.stringify(defaultExpenses));
  }
};

// Seed instantly on load of this script
seedLocalStorageIfNeeded();

// Unified active user state (holds either the Firestore logged-in profile or a simulated profile)
let activeUserProfile: UserProfile | null = null;
const storedMockUser = localStorage.getItem('simulated_active_user') || localStorage.getItem(LS_KEYS.ACTIVE_USER);
if (storedMockUser) {
  try {
    activeUserProfile = JSON.parse(storedMockUser);
  } catch {
    activeUserProfile = null;
  }
}

// Unified auth listeners list
let unifiedAuthCallbacks: ((user: UserProfile | null) => void)[] = [];


// ==========================================
// UNIFIED SECURITY DATA INTERFACES
// ==========================================

export const yogaAuth = {
  isMockMode: () => isMock,

  // Subscribe to changes in authorization status
  onAuthStateChanged: (callback: (user: UserProfile | null) => void) => {
    unifiedAuthCallbacks.push(callback);
    
    // Trigger immediately with current active user if already resolved
    if (activeUserProfile) {
      callback(activeUserProfile);
    } else if (isMock) {
      callback(null);
    }
    
    let unsubscribeFirebase: (() => void) | null = null;

    if (!isMock && auth) {
      // Live Firebase Auth Listener
      unsubscribeFirebase = auth.onAuthStateChanged(async (firebaseUser: FirebaseUser | null) => {
        // If there's an active simulated user, do not let Firebase Auth's null state override it
        if (localStorage.getItem('simulated_active_user')) {
          const simulatedUser = JSON.parse(localStorage.getItem('simulated_active_user') || 'null');
          if (simulatedUser) {
            activeUserProfile = simulatedUser;
            callback(simulatedUser);
            return;
          }
        }

        if (!firebaseUser) {
          activeUserProfile = null;
          callback(null);
          return;
        }

        // Fetch user profile from firestore
        try {
          const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (profileDoc.exists()) {
            const profile = profileDoc.data() as UserProfile;
            activeUserProfile = profile;
            callback(profile);
          } else {
            // Logged in via Google for first time, create standard student profile
            // Check if high administrative privileges apply: check if email is admin
            const isAdminEmail = firebaseUser.email === "joaquinvillanuevavarela@gmail.com" || 
                               firebaseUser.email === "valentina@yoga.com";
            
            const newProfile: UserProfile = {
              userId: firebaseUser.uid,
              email: firebaseUser.email || '',
              displayName: firebaseUser.displayName || 'Estudiante Nuevo',
              role: isAdminEmail ? 'admin' : 'student',
              createdAt: new Date().toISOString()
            };
            
            await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
            activeUserProfile = newProfile;
            callback(newProfile);
          }
        } catch (error) {
          console.error("Error reading live user profile", error);
          activeUserProfile = null;
          callback(null);
        }
      });
    }

    return () => {
      unifiedAuthCallbacks = unifiedAuthCallbacks.filter(cb => cb !== callback);
      if (unsubscribeFirebase) {
        unsubscribeFirebase();
      }
    };
  },

  // Perform login
  signInWithGoogle: async (): Promise<UserProfile> => {
    // Clear simulated user
    localStorage.removeItem('simulated_active_user');

    if (isMock) {
      // Emulate Google popup login by targeting Joaquín's demo student or Valentina's admin profile
      const usersRaw = localStorage.getItem(LS_KEYS.USERS);
      const users: Record<string, UserProfile> = usersRaw ? JSON.parse(usersRaw) : {};
      
      const userList = Object.values(users);
      const user = userList.find(u => u.email === 'joaquinvillanuevavarela@gmail.com') || userList[0] || {
        userId: 'student_demo',
        email: 'joaquinvillanuevavarela@gmail.com',
        displayName: 'Joaquín V.',
        role: 'student',
        createdAt: new Date().toISOString()
      };
      
      activeUserProfile = user;
      localStorage.setItem(LS_KEYS.ACTIVE_USER, JSON.stringify(user));
      unifiedAuthCallbacks.forEach(cb => cb(user));
      return user;
    } else {
      // Live Google Login via Popup as recommended for iframe
      const provider = new GoogleAuthProvider();
      try {
        const result = await signInWithPopup(auth, provider);
        const firebaseUser = result.user;
        
        const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (profileDoc.exists()) {
          const profile = profileDoc.data() as UserProfile;
          activeUserProfile = profile;
          unifiedAuthCallbacks.forEach(cb => cb(profile));
          return profile;
        } else {
          const isAdminEmail = firebaseUser.email === "joaquinvillanuevavarela@gmail.com" || 
                               firebaseUser.email === "valentina@yoga.com";
          
          const newProfile: UserProfile = {
            userId: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'Estudiante',
            role: isAdminEmail ? 'admin' : 'student',
            createdAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
          activeUserProfile = newProfile;
          unifiedAuthCallbacks.forEach(cb => cb(newProfile));
          return newProfile;
        }
      } catch (error) {
        console.error("Google Authenticator popup failed", error);
        throw error;
      }
    }
  },

  // Login as any of the roles for simulated walkthrough in sandbox mode
  simulateUserLogin: async (email: string, role: UserRole, displayName: string) => {
    let user: UserProfile;

    if (!isMock && auth && db) {
      try {
        // Authenticate anonymously so we have a valid request.auth in Firestore security rules
        const userCredential = await signInAnonymously(auth);
        const uid = userCredential.user.uid;
        
        user = {
          userId: uid,
          email,
          displayName,
          role,
          createdAt: new Date().toISOString()
        };
        
        // Write their user profile to Firestore so that exists() matching in isAdmin() rule works!
        await setDoc(doc(db, 'users', uid), user);
      } catch (err) {
        console.error("Failed anonymous authentication in Live Mode, falling back:", err);
        const generatedId = 'user_sim_' + Math.random().toString(36).substr(2, 9);
        user = {
          userId: generatedId,
          email,
          displayName,
          role,
          createdAt: new Date().toISOString()
        };
      }
    } else {
      // Register or recover from LS
      const usersRaw = localStorage.getItem(LS_KEYS.USERS);
      const users: Record<string, UserProfile> = usersRaw ? JSON.parse(usersRaw) : {};
      
      // Check if user already exists
      let existingUser = Object.values(users).find(u => u.email === email);
      if (!existingUser) {
        const generatedId = 'user_' + Math.random().toString(36).substr(2, 9);
        existingUser = {
          userId: generatedId,
          email,
          displayName,
          role,
          createdAt: new Date().toISOString()
        };
        users[generatedId] = existingUser;
        localStorage.setItem(LS_KEYS.USERS, JSON.stringify(users));
      }
      user = existingUser;
    }
    
    activeUserProfile = user;
    localStorage.setItem('simulated_active_user', JSON.stringify(user));
    localStorage.setItem(LS_KEYS.ACTIVE_USER, JSON.stringify(user));
    unifiedAuthCallbacks.forEach(cb => cb(user));
    return user;
  },

  // Sign out user session
  signOut: async (): Promise<void> => {
    activeUserProfile = null;
    localStorage.removeItem('simulated_active_user');
    localStorage.removeItem(LS_KEYS.ACTIVE_USER);
    
    if (!isMock && auth) {
      try {
        await signOut(auth);
      } catch (e) {
        console.error(e);
      }
    }
    
    unifiedAuthCallbacks.forEach(cb => cb(null));
  }
};


// ==========================================
// UNIFIED DATA OPERATIONS FOR CLOUD & SANDBOX
// ==========================================

export const yogaDatabase = {
  // --- USERS ---
  getUserProfile: async (userId: string): Promise<UserProfile | null> => {
    if (isMock) {
      const usersRaw = localStorage.getItem(LS_KEYS.USERS);
      const users: Record<string, UserProfile> = usersRaw ? JSON.parse(usersRaw) : {};
      return users[userId] || null;
    } else {
      const path = `users/${userId}`;
      try {
        const docSnap = await getDoc(doc(db, 'users', userId));
        return docSnap.exists() ? (docSnap.data() as UserProfile) : null;
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
      }
    }
  },

  getAllUsers: async (): Promise<UserProfile[]> => {
    if (isMock) {
      const usersRaw = localStorage.getItem(LS_KEYS.USERS);
      const users: Record<string, UserProfile> = usersRaw ? JSON.parse(usersRaw) : {};
      return Object.values(users);
    } else {
      const path = 'users';
      try {
        const querySnapshot = await getDocs(collection(db, path));
        return querySnapshot.docs.map(doc => doc.data() as UserProfile);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  },

  // --- PACKAGES ---
  getPackages: async (): Promise<ClassPackage[]> => {
    if (isMock) {
      const pkgsRaw = localStorage.getItem(LS_KEYS.PACKAGES);
      return pkgsRaw ? JSON.parse(pkgsRaw) : [];
    } else {
      const path = 'packages';
      try {
        const querySnapshot = await getDocs(collection(db, path));
        return querySnapshot.docs.map(doc => doc.data() as ClassPackage);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    }
  },

  createPackage: async (pkg: ClassPackage): Promise<void> => {
    if (isMock) {
      const pkgs = await yogaDatabase.getPackages();
      pkgs.push(pkg);
      localStorage.setItem(LS_KEYS.PACKAGES, JSON.stringify(pkgs));
    } else {
      const path = `packages/${pkg.packageId}`;
      try {
        await setDoc(doc(db, 'packages', pkg.packageId), pkg);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    }
  },

  updatePackage: async (packageId: string, updates: Partial<ClassPackage>): Promise<void> => {
    if (isMock) {
      const pkgs = await yogaDatabase.getPackages();
      const idx = pkgs.findIndex(p => p.packageId === packageId);
      if (idx !== -1) {
        pkgs[idx] = { ...pkgs[idx], ...updates };
        localStorage.setItem(LS_KEYS.PACKAGES, JSON.stringify(pkgs));
      }
    } else {
      const path = `packages/${packageId}`;
      try {
        await updateDoc(doc(db, 'packages', packageId), updates);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }
  },

  // --- BOOKINGS ---
  getBookings: async (): Promise<Booking[]> => {
    const normalizeClassTime = (time: string): string => {
      const t = time.trim();
      if (t === '07:00' || t === '7:00' || t === '07:00 AM') return '07:00';
      if (t === '08:30' || t === '8:30' || t === '09:00' || t === '09:00 AM') return '09:00';
      if (t === '10:00' || t === '11:00' || t === '11:30' || t === '11:00 AM') return '11:00';
      if (t === '13:00' || t === '15:00' || t === '13:00 PM') return '13:00';
      if (t === '16:30' || t === '17:30' || t === '16:30 PM') return '16:30';
      if (t === '18:30' || t === '19:00' || t === '18:30 PM') return '18:30';
      return t;
    };

    if (isMock) {
      const bookingsRaw = localStorage.getItem(LS_KEYS.BOOKINGS);
      const parsed = bookingsRaw ? JSON.parse(bookingsRaw) : [];
      return parsed.map((b: Booking) => ({ ...b, classTime: normalizeClassTime(b.classTime) }));
    } else {
      const path = 'bookings';
      try {
        const querySnapshot = await getDocs(collection(db, path));
        return querySnapshot.docs.map(doc => {
          const b = doc.data() as Booking;
          return { ...b, classTime: normalizeClassTime(b.classTime) };
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
        return [];
      }
    }
  },

  createBooking: async (booking: Booking): Promise<void> => {
    if (isMock) {
      const bookings = await yogaDatabase.getBookings();
      bookings.push(booking);
      localStorage.setItem(LS_KEYS.BOOKINGS, JSON.stringify(bookings));
    } else {
      const path = `bookings/${booking.bookingId}`;
      try {
        await setDoc(doc(db, 'bookings', booking.bookingId), booking);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    }
  },

  updateBookingStatus: async (bookingId: string, status: BookingStatus): Promise<void> => {
    if (isMock) {
      const bookings = await yogaDatabase.getBookings();
      const idx = bookings.findIndex(b => b.bookingId === bookingId);
      if (idx !== -1) {
        const booking = bookings[idx];
        const oldStatus = booking.status;
        booking.status = status;
        localStorage.setItem(LS_KEYS.BOOKINGS, JSON.stringify(bookings));

        // IF Status is changed to 'attended' AND student holds a 10/20 class package, deduct 1 class automáticamente!
        if (status === 'attended' && oldStatus !== 'attended') {
          // Find active student package
          const pkgs = await yogaDatabase.getPackages();
          const studentPkg = pkgs.find(p => p.studentId === booking.studentId && 
            (p.type === '10_classes' || p.type === '20_classes') && 
            p.remainingClasses > 0 && 
            p.status !== 'expired');
            
          if (studentPkg) {
            const nextRemaining = Math.max(0, studentPkg.remainingClasses - 1);
            const statusUpdate = nextRemaining <= 2 ? (nextRemaining === 0 ? 'dormant' : 'expiring') : 'active';
            await yogaDatabase.updatePackage(studentPkg.packageId, { 
              remainingClasses: nextRemaining,
              status: statusUpdate as any
            });
          }
        }
        
        // IF attendance is CANCELLED but previously ATTENDED, we restore a class credit
        if (status === 'cancelled' && oldStatus === 'attended') {
          const pkgs = await yogaDatabase.getPackages();
          const studentPkg = pkgs.find(p => p.studentId === booking.studentId && 
            (p.type === '10_classes' || p.type === '20_classes'));
            
          if (studentPkg) {
            const nextRemaining = Math.min(studentPkg.totalClasses, studentPkg.remainingClasses + 1);
            const statusUpdate = nextRemaining <= 2 ? 'expiring' : 'active';
            await yogaDatabase.updatePackage(studentPkg.packageId, { 
              remainingClasses: nextRemaining,
              status: statusUpdate as any
            });
          }
        }
      }
    } else {
      const path = `bookings/${bookingId}`;
      try {
        // Enforce the automated attendance reduction logic in cloudfirestore
        const bookingDoc = await getDoc(doc(db, 'bookings', bookingId));
        if (bookingDoc.exists()) {
          const bookingData = bookingDoc.data() as Booking;
          const oldStatus = bookingData.status;
          
          await updateDoc(doc(db, 'bookings', bookingId), { status });
          
          // Class reduction triggers inside live cloud app
          if (status === 'attended' && oldStatus !== 'attended') {
            const pkgsSnap = await getDocs(query(collection(db, 'packages'), 
              where('studentId', '==', bookingData.studentId),
              where('status', 'in', ['active', 'expiring'])
            ));
            
            const clientPkg = pkgsSnap.docs
              .map(d => d.data() as ClassPackage)
              .find(p => p.type === '10_classes' || p.type === '20_classes');
              
            if (clientPkg && clientPkg.remainingClasses > 0) {
              const nextRem = Math.max(0, clientPkg.remainingClasses - 1);
              const statusUpd = nextRem <= 2 ? (nextRem === 0 ? 'dormant' : 'expiring') : 'active';
              await updateDoc(doc(db, 'packages', clientPkg.packageId), {
                remainingClasses: nextRem,
                status: statusUpd
              });
            }
          }

          if (status === 'cancelled' && oldStatus === 'attended') {
            const pkgsSnap = await getDocs(query(collection(db, 'packages'), 
              where('studentId', '==', bookingData.studentId)
            ));
            const clientPkg = pkgsSnap.docs
              .map(d => d.data() as ClassPackage)
              .find(p => p.type === '10_classes' || p.type === '20_classes');
              
            if (clientPkg) {
              const nextRem = Math.min(clientPkg.totalClasses, clientPkg.remainingClasses + 1);
              const statusUpd = nextRem <= 2 ? 'expiring' : 'active';
              await updateDoc(doc(db, 'packages', clientPkg.packageId), {
                remainingClasses: nextRem,
                status: statusUpd
              });
            }
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
    }
  },

  // --- CLASSES ---
  getClasses: async (): Promise<YogaClass[]> => {
    const normalizeClassTime = (time: string): string => {
      const t = time.trim();
      if (t === '07:00' || t === '7:00' || t === '07:00 AM') return '07:00';
      if (t === '08:30' || t === '8:30' || t === '09:00' || t === '09:00 AM') return '09:00';
      if (t === '10:00' || t === '11:00' || t === '11:30' || t === '11:00 AM') return '11:00';
      if (t === '13:00' || t === '15:00' || t === '13:00 PM') return '13:00';
      if (t === '16:30' || t === '17:30' || t === '16:30 PM') return '16:30';
      if (t === '18:30' || t === '19:00' || t === '18:30 PM') return '18:30';
      return t;
    };

    if (isMock) {
      const classesRaw = localStorage.getItem('yoga_studio_classes');
      if (!classesRaw) {
        const normed = INITIAL_CLASSES.map(cls => ({ ...cls, time: normalizeClassTime(cls.time) }));
        localStorage.setItem('yoga_studio_classes', JSON.stringify(normed));
        return normed;
      }
      try {
        const parsed = JSON.parse(classesRaw) as YogaClass[];
        return parsed.map(cls => ({ ...cls, time: normalizeClassTime(cls.time) }));
      } catch {
        return INITIAL_CLASSES.map(cls => ({ ...cls, time: normalizeClassTime(cls.time) }));
      }
    } else {
      const path = 'classes';
      try {
        const querySnapshot = await getDocs(collection(db, path));
        if (querySnapshot.empty) {
          // Seed initial classes
          for (const cls of INITIAL_CLASSES) {
            const normedCls = { ...cls, time: normalizeClassTime(cls.time) };
            await setDoc(doc(db, 'classes', cls.classId), normedCls);
          }
          return INITIAL_CLASSES.map(cls => ({ ...cls, time: normalizeClassTime(cls.time) }));
        }
        return querySnapshot.docs.map(doc => {
          const cls = doc.data() as YogaClass;
          return { ...cls, time: normalizeClassTime(cls.time) };
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
        return [];
      }
    }
  },

  saveClass: async (cls: YogaClass): Promise<void> => {
    if (isMock) {
      const classes = await yogaDatabase.getClasses();
      const idx = classes.findIndex(c => c.classId === cls.classId);
      if (idx !== -1) {
        classes[idx] = cls;
      } else {
        classes.push(cls);
      }
      localStorage.setItem('yoga_studio_classes', JSON.stringify(classes));
    } else {
      const path = `classes/${cls.classId}`;
      try {
        await setDoc(doc(db, 'classes', cls.classId), cls);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    }
  },

  deleteClass: async (classId: string): Promise<void> => {
    if (isMock) {
      const classes = await yogaDatabase.getClasses();
      const filtered = classes.filter(c => c.classId !== classId);
      localStorage.setItem('yoga_studio_classes', JSON.stringify(filtered));
    } else {
      const path = `classes/${classId}`;
      try {
        await deleteDoc(doc(db, 'classes', classId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  },

  getExpenses: async (): Promise<Expense[]> => {
    if (isMock) {
      const expensesRaw = localStorage.getItem('yoga_studio_expenses');
      return expensesRaw ? JSON.parse(expensesRaw) : [];
    } else {
      const path = 'expenses';
      try {
        const querySnapshot = await getDocs(collection(db, path));
        return querySnapshot.docs.map(doc => doc.data() as Expense);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
        return [];
      }
    }
  },

  saveExpense: async (expense: Expense): Promise<void> => {
    if (isMock) {
      const expenses = await yogaDatabase.getExpenses();
      const idx = expenses.findIndex(e => e.expenseId === expense.expenseId);
      if (idx !== -1) {
        expenses[idx] = expense;
      } else {
        expenses.push(expense);
      }
      localStorage.setItem('yoga_studio_expenses', JSON.stringify(expenses));
    } else {
      const path = `expenses/${expense.expenseId}`;
      try {
        await setDoc(doc(db, 'expenses', expense.expenseId), expense);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    }
  },

  deleteExpense: async (expenseId: string): Promise<void> => {
    if (isMock) {
      const expenses = await yogaDatabase.getExpenses();
      const filtered = expenses.filter(e => e.expenseId !== expenseId);
      localStorage.setItem('yoga_studio_expenses', JSON.stringify(filtered));
    } else {
      const path = `expenses/${expenseId}`;
      try {
        await deleteDoc(doc(db, 'expenses', expenseId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  },

  // --- MIGRATION UTILITY ---
  migrateLocalDataToFirestore: async (): Promise<{ success: boolean; count: number; error?: string }> => {
    if (isMock) {
      return { success: false, count: 0, error: 'La aplicación está en Modo Sandbox (Local). Cambia a Modo Live para migrar.' };
    }
    
    try {
      let count = 0;

      // 1. Migrate Users
      const localUsersRaw = localStorage.getItem(LS_KEYS.USERS);
      if (localUsersRaw) {
        const localUsers: Record<string, UserProfile> = JSON.parse(localUsersRaw);
        for (const [userId, user] of Object.entries(localUsers)) {
          try {
            await setDoc(doc(db, 'users', userId), user);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
          }
        }
      }

      // 2. Migrate Packages
      const localPkgsRaw = localStorage.getItem(LS_KEYS.PACKAGES);
      if (localPkgsRaw) {
        const localPkgs: ClassPackage[] = JSON.parse(localPkgsRaw);
        for (const pkg of localPkgs) {
          try {
            await setDoc(doc(db, 'packages', pkg.packageId), pkg);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `packages/${pkg.packageId}`);
          }
        }
      }

      // 3. Migrate Bookings
      const localBookingsRaw = localStorage.getItem(LS_KEYS.BOOKINGS);
      if (localBookingsRaw) {
        const localBookings: Booking[] = JSON.parse(localBookingsRaw);
        for (const booking of localBookings) {
          try {
            await setDoc(doc(db, 'bookings', booking.bookingId), booking);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `bookings/${booking.bookingId}`);
          }
        }
      }

      // 4. Migrate Classes
      const localClassesRaw = localStorage.getItem('yoga_studio_classes');
      if (localClassesRaw) {
        const localClasses: YogaClass[] = JSON.parse(localClassesRaw);
        for (const cls of localClasses) {
          try {
            await setDoc(doc(db, 'classes', cls.classId), cls);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `classes/${cls.classId}`);
          }
        }
      } else {
        // If no custom local classes, sync default ones
        for (const cls of INITIAL_CLASSES) {
          try {
            await setDoc(doc(db, 'classes', cls.classId), cls);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `classes/${cls.classId}`);
          }
        }
      }

      // 5. Migrate Expenses
      const localExpensesRaw = localStorage.getItem('yoga_studio_expenses');
      if (localExpensesRaw) {
        const localExpenses: Expense[] = JSON.parse(localExpensesRaw);
        for (const expense of localExpenses) {
          try {
            await setDoc(doc(db, 'expenses', expense.expenseId), expense);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `expenses/${expense.expenseId}`);
          }
        }
      }

      return { success: true, count };
    } catch (e: any) {
      console.error("Migration to Firestore failed:", e);
      return { success: false, count: 0, error: e.message || String(e) };
    }
  },

  // --- COMPREHENSIVE SEEDING ENGINE FROM SCRATCH ---
  resetAndSeedDatabase: async (): Promise<{ success: boolean; count: number; error?: string }> => {
    try {
      let count = 0;
      const now = new Date();

      // 1. Dynamic User Accounts & Instructors List
      const usersToSeed: Record<string, UserProfile> = {
        'admin_val': {
          userId: 'admin_val',
          email: 'valentina@yoga.com',
          displayName: 'Valentina (Propietaria)',
          role: 'admin',
          createdAt: new Date().toISOString()
        },
        'student_demo': {
          userId: 'student_demo',
          email: 'joaquinvillanuevavarela@gmail.com',
          displayName: 'Joaquín V.',
          role: 'admin', // Ensure Joaquin has admin privileges to view stats in dev auth
          createdAt: new Date().toISOString()
        },
        'student_lucia': {
          userId: 'student_lucia',
          email: 'lucia@gmail.com',
          displayName: 'Lucía G.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_mateo': {
          userId: 'student_mateo',
          email: 'mateo@gmail.com',
          displayName: 'Mateo R.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_clara': {
          userId: 'student_clara',
          email: 'clara@gmail.com',
          displayName: 'Clara S.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_carlos': {
          userId: 'student_carlos',
          email: 'carlos@gmail.com',
          displayName: 'Carlos P.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_gabriela': {
          userId: 'student_gabriela',
          email: 'gabriela@gmail.com',
          displayName: 'Gabriela M.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_andres': {
          userId: 'student_andres',
          email: 'andres@gmail.com',
          displayName: 'Andrés L.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_valeria': {
          userId: 'student_valeria',
          email: 'valeria@gmail.com',
          displayName: 'Valeria T.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_tomas': {
          userId: 'student_tomas',
          email: 'tomas@gmail.com',
          displayName: 'Tomás D.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_daniela': {
          userId: 'student_daniela',
          email: 'daniela@gmail.com',
          displayName: 'Daniela F.',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_sofia_l': {
          userId: 'student_sofia_l',
          email: 'sofialarrain@gmail.com',
          displayName: 'Sofía Larraín',
          role: 'student',
          createdAt: new Date().toISOString()
        },
        'student_pedro': {
          userId: 'student_pedro',
          email: 'pedros@gmail.com',
          displayName: 'Pedro S.',
          role: 'student',
          createdAt: new Date().toISOString()
        }
      };

      // 2. Class Packages Balance Sheets (Lucía, Mateo, Clara with active/expired plans starting in April)
      const packagesToSeed: ClassPackage[] = [
        // --- LUCÍA G. ---
        {
          packageId: 'pkg_lucia_april',
          studentId: 'student_lucia',
          studentName: 'Lucía G.',
          studentEmail: 'lucia@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 0,
          purchaseDate: '2026-04-02T10:00:00.000Z',
          expiryDate: '2026-05-17T10:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_lucia_may',
          studentId: 'student_lucia',
          studentName: 'Lucía G.',
          studentEmail: 'lucia@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 11, // Attended 9 classes under this package
          purchaseDate: '2026-05-02T11:00:00.000Z',
          expiryDate: '2026-07-02T11:00:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_lucia_june',
          studentId: 'student_lucia',
          studentName: 'Lucía G.',
          studentEmail: 'lucia@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-06-01T10:00:00.000Z',
          expiryDate: '2026-07-01T10:00:00.000Z',
          status: 'active'
        },

        // --- MATEO R. ---
        {
          packageId: 'pkg_mateo_april',
          studentId: 'student_mateo',
          studentName: 'Mateo R.',
          studentEmail: 'mateo@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 0,
          purchaseDate: '2026-04-05T09:30:00.000Z',
          expiryDate: '2026-05-20T09:30:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_mateo_may',
          studentId: 'student_mateo',
          studentName: 'Mateo R.',
          studentEmail: 'mateo@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 17, // Attended 3 classes under this package
          purchaseDate: '2026-05-15T15:00:00.000Z',
          expiryDate: '2026-07-15T15:00:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_mateo_june',
          studentId: 'student_mateo',
          studentName: 'Mateo R.',
          studentEmail: 'mateo@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-06-02T10:30:00.000Z',
          expiryDate: '2026-07-02T10:30:00.000Z',
          status: 'active'
        },

        // --- CLARA S. ---
        {
          packageId: 'pkg_clara_april',
          studentId: 'student_clara',
          studentName: 'Clara S.',
          studentEmail: 'clara@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 0,
          purchaseDate: '2026-04-12T14:00:00.000Z',
          expiryDate: '2026-05-27T14:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_clara_may',
          studentId: 'student_clara',
          studentName: 'Clara S.',
          studentEmail: 'clara@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 7, // Attended 3 classes under this package
          purchaseDate: '2026-05-25T08:00:00.000Z',
          expiryDate: '2026-06-25T08:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_clara_june',
          studentId: 'student_clara',
          studentName: 'Clara S.',
          studentEmail: 'clara@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 10,
          purchaseDate: '2026-06-01T08:00:00.000Z',
          expiryDate: '2026-07-16T08:00:00.000Z',
          status: 'active'
        },

        // --- JOAQUÍN V. ---
        {
          packageId: 'pkg_joaquin_demo',
          studentId: 'student_demo',
          studentName: 'Joaquín V.',
          studentEmail: 'joaquinvillanuevavarela@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 5, // Attended 5 classes
          purchaseDate: '2026-04-01T08:30:00.000Z',
          expiryDate: '2026-06-30T08:30:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_joaquin_june',
          studentId: 'student_demo',
          studentName: 'Joaquín V.',
          studentEmail: 'joaquinvillanuevavarela@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 10,
          purchaseDate: '2026-06-08T09:00:00.000Z',
          expiryDate: '2026-08-08T09:00:00.000Z',
          status: 'active'
        },

        // --- CARLOS P. ---
        {
          packageId: 'pkg_carlos_expired',
          studentId: 'student_carlos',
          studentName: 'Carlos P.',
          studentEmail: 'carlos@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 12,
          purchaseDate: '2026-03-01T09:00:00.000Z',
          expiryDate: '2026-05-01T09:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_carlos_april',
          studentId: 'student_carlos',
          studentName: 'Carlos P.',
          studentEmail: 'carlos@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 0,
          purchaseDate: '2026-04-20T09:00:00.000Z',
          expiryDate: '2026-05-20T09:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_carlos_may',
          studentId: 'student_carlos',
          studentName: 'Carlos P.',
          studentEmail: 'carlos@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 8,
          purchaseDate: '2026-05-20T09:00:00.000Z',
          expiryDate: '2026-07-20T09:00:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_carlos_june',
          studentId: 'student_carlos',
          studentName: 'Carlos P.',
          studentEmail: 'carlos@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 20,
          purchaseDate: '2026-06-05T09:00:00.000Z',
          expiryDate: '2026-08-05T09:00:00.000Z',
          status: 'active'
        },

        // --- GABRIELA M. ---
        {
          packageId: 'pkg_gabriela_april',
          studentId: 'student_gabriela',
          studentName: 'Gabriela M.',
          studentEmail: 'gabriela@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 0,
          purchaseDate: '2026-04-04T11:00:00.000Z',
          expiryDate: '2026-05-19T11:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_gabriela_may',
          studentId: 'student_gabriela',
          studentName: 'Gabriela M.',
          studentEmail: 'gabriela@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 4,
          purchaseDate: '2026-05-04T11:00:00.000Z',
          expiryDate: '2026-07-04T11:00:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_gabriela_june',
          studentId: 'student_gabriela',
          studentName: 'Gabriela M.',
          studentEmail: 'gabriela@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-06-03T11:00:00.000Z',
          expiryDate: '2026-07-03T11:00:00.000Z',
          status: 'active'
        },

        // --- ANDRÉS L. ---
        {
          packageId: 'pkg_andres_april',
          studentId: 'student_andres',
          studentName: 'Andrés L.',
          studentEmail: 'andres@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 0,
          purchaseDate: '2026-04-08T15:00:00.000Z',
          expiryDate: '2026-05-08T15:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_andres_may',
          studentId: 'student_andres',
          studentName: 'Andrés L.',
          studentEmail: 'andres@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-05-08T15:00:00.000Z',
          expiryDate: '2026-06-08T15:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_andres_june',
          studentId: 'student_andres',
          studentName: 'Andrés L.',
          studentEmail: 'andres@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-06-04T15:00:00.000Z',
          expiryDate: '2026-07-04T15:00:00.000Z',
          status: 'active'
        },

        // --- VALERIA T. ---
        {
          packageId: 'pkg_valeria_april',
          studentId: 'student_valeria',
          studentName: 'Valeria T.',
          studentEmail: 'valeria@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 0,
          purchaseDate: '2026-04-15T12:00:00.000Z',
          expiryDate: '2026-05-15T12:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_valeria_may',
          studentId: 'student_valeria',
          studentName: 'Valeria T.',
          studentEmail: 'valeria@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-05-15T12:00:00.000Z',
          expiryDate: '2026-06-15T12:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_valeria_june',
          studentId: 'student_valeria',
          studentName: 'Valeria T.',
          studentEmail: 'valeria@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-06-04T12:00:00.000Z',
          expiryDate: '2026-07-04T12:00:00.000Z',
          status: 'active'
        },

        // --- TOMÁS D. ---
        {
          packageId: 'pkg_tomas_april',
          studentId: 'student_tomas',
          studentName: 'Tomás D.',
          studentEmail: 'tomas@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 0,
          purchaseDate: '2026-04-18T16:30:00.000Z',
          expiryDate: '2026-06-02T16:30:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_tomas_may',
          studentId: 'student_tomas',
          studentName: 'Tomás D.',
          studentEmail: 'tomas@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 10,
          purchaseDate: '2026-05-18T16:30:00.000Z',
          expiryDate: '2026-07-18T16:30:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_tomas_june',
          studentId: 'student_tomas',
          studentName: 'Tomás D.',
          studentEmail: 'tomas@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 20,
          purchaseDate: '2026-06-05T16:30:00.000Z',
          expiryDate: '2026-08-05T16:30:00.000Z',
          status: 'active'
        },

        // --- DANIELA F. ---
        {
          packageId: 'pkg_daniela_april',
          studentId: 'student_daniela',
          studentName: 'Daniela F.',
          studentEmail: 'daniela@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 0,
          purchaseDate: '2026-04-22T09:45:00.000Z',
          expiryDate: '2026-06-06T09:45:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_daniela_may',
          studentId: 'student_daniela',
          studentName: 'Daniela F.',
          studentEmail: 'daniela@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 4,
          purchaseDate: '2026-05-22T09:45:00.000Z',
          expiryDate: '2026-07-22T09:45:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_daniela_june',
          studentId: 'student_daniela',
          studentName: 'Daniela F.',
          studentEmail: 'daniela@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 20,
          purchaseDate: '2026-06-06T09:45:00.000Z',
          expiryDate: '2026-08-06T09:45:00.000Z',
          status: 'active'
        },

        // --- SOFÍA LARRAÍN ---
        {
          packageId: 'pkg_sofial_may',
          studentId: 'student_sofia_l',
          studentName: 'Sofía Larraín',
          studentEmail: 'sofialarrain@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-05-10T11:00:00.000Z',
          expiryDate: '2026-06-10T11:00:00.000Z',
          status: 'expired'
        },
        {
          packageId: 'pkg_sofial_june',
          studentId: 'student_sofia_l',
          studentName: 'Sofía Larraín',
          studentEmail: 'sofialarrain@gmail.com',
          type: 'unlimited',
          pricePaid: 120000,
          totalClasses: 99,
          remainingClasses: 99,
          purchaseDate: '2026-06-06T11:00:00.000Z',
          expiryDate: '2026-07-06T11:00:00.000Z',
          status: 'active'
        },

        // --- PEDRO S. ---
        {
          packageId: 'pkg_pedros_may',
          studentId: 'student_pedro',
          studentName: 'Pedro S.',
          studentEmail: 'pedros@gmail.com',
          type: '10_classes',
          pricePaid: 50000,
          totalClasses: 10,
          remainingClasses: 2,
          purchaseDate: '2026-05-12T14:15:00.000Z',
          expiryDate: '2026-07-12T14:15:00.000Z',
          status: 'active'
        },
        {
          packageId: 'pkg_pedros_june',
          studentId: 'student_pedro',
          studentName: 'Pedro S.',
          studentEmail: 'pedros@gmail.com',
          type: '20_classes',
          pricePaid: 90000,
          totalClasses: 20,
          remainingClasses: 20,
          purchaseDate: '2026-06-07T14:15:00.000Z',
          expiryDate: '2026-08-07T14:15:00.000Z',
          status: 'active'
        }
      ];

      // 3. Classes Setup
      const classesToSeed: YogaClass[] = INITIAL_CLASSES.map(cls => ({
        ...cls,
        time: cls.time.trim()
      }));

      // 4. Booking History with Lucía, Mateo, Clara & Joaquín, making Sofía the best instructor
      const mockBookingsToSeed: Booking[] = [
        // ================= APRIL 2026 =================
        { bookingId: 'b_apr_1', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-04-06', classTime: '07:00', status: 'attended', createdAt: '2026-04-05T18:00:00.000Z' },
        { bookingId: 'b_apr_2', classId: 'wed_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-04-08', classTime: '07:00', status: 'attended', createdAt: '2026-04-07T19:00:00.000Z' },
        { bookingId: 'b_apr_3', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-04-10', classTime: '07:00', status: 'attended', createdAt: '2026-04-09T20:00:00.000Z' },
        { bookingId: 'b_apr_4', classId: 'sat_1', className: 'Ashtanga Pro Sábado', instructor: 'Camila', studentId: 'student_demo', studentName: 'Joaquín V.', studentEmail: 'joaquinvillanuevavarela@gmail.com', classDate: '2026-04-11', classTime: '08:30', status: 'attended', createdAt: '2026-04-10T15:00:00.000Z' },
        { bookingId: 'b_apr_5', classId: 'mon_2', className: 'Hatha Tradicional', instructor: 'Matías', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-04-13', classTime: '08:30', status: 'attended', createdAt: '2026-04-12T14:00:00.000Z' },
        { bookingId: 'b_apr_6', classId: 'wed_4', className: 'Restaurativo & Yin', instructor: 'Lucas', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-04-15', classTime: '17:30', status: 'attended', createdAt: '2026-04-14T09:00:00.000Z' },
        { bookingId: 'b_apr_7', classId: 'fri_3', className: 'Ashtanga Mysore', instructor: 'Camila', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-04-17', classTime: '10:00', status: 'attended', createdAt: '2026-04-16T11:00:00.000Z' },
        { bookingId: 'b_apr_8', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-04-20', classTime: '07:00', status: 'attended', createdAt: '2026-04-19T18:00:00.000Z' },
        { bookingId: 'b_apr_9', classId: 'wed_5', className: 'Vinyasa Pro', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-04-22', classTime: '19:00', status: 'attended', createdAt: '2026-04-21T10:00:00.000Z' },
        { bookingId: 'b_apr_10', classId: 'fri_5', className: 'Meditación Guiada', instructor: 'Lucas', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-04-24', classTime: '19:00', status: 'cancelled', createdAt: '2026-04-23T12:00:00.000Z' },
        { bookingId: 'b_apr_11', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_demo', studentName: 'Joaquín V.', studentEmail: 'joaquinvillanuevavarela@gmail.com', classDate: '2026-04-27', classTime: '07:00', status: 'attended', createdAt: '2026-04-26T14:00:00.000Z' },

        // ================= MAY 2026 =================
        { bookingId: 'b_may_1', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-05-04', classTime: '07:00', status: 'attended', createdAt: '2026-05-03T18:00:00.000Z' },
        { bookingId: 'b_may_2', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-05-04', classTime: '07:00', status: 'attended', createdAt: '2026-05-03T19:00:00.000Z' },
        { bookingId: 'b_may_3', classId: 'wed_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-05-06', classTime: '07:00', status: 'attended', createdAt: '2026-05-05T20:00:00.000Z' },
        { bookingId: 'b_may_4', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-05-08', classTime: '07:00', status: 'attended', createdAt: '2026-05-07T08:00:00.000Z' },
        { bookingId: 'b_may_5', classId: 'sat_1', className: 'Ashtanga Pro Sábado', instructor: 'Camila', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-05-09', classTime: '08:30', status: 'attended', createdAt: '2026-05-08T15:00:00.000Z' },
        { bookingId: 'b_may_6', classId: 'mon_2', className: 'Hatha Tradicional', instructor: 'Matías', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-05-11', classTime: '08:30', status: 'attended', createdAt: '2026-05-10T14:00:00.000Z' },
        { bookingId: 'b_may_7', classId: 'wed_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-05-13', classTime: '07:00', status: 'attended', createdAt: '2026-05-12T10:00:00.000Z' },
        { bookingId: 'b_may_8', classId: 'mon_4', className: 'Restaurativo & Yin', instructor: 'Lucas', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-05-15', classTime: '17:30', status: 'attended', createdAt: '2026-05-14T09:00:00.000Z' },
        { bookingId: 'b_may_9', classId: 'sat_2', className: 'Vinyasa Weekend', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-05-16', classTime: '10:00', status: 'attended', createdAt: '2026-05-15T11:00:00.000Z' },
        { bookingId: 'b_may_10', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-05-18', classTime: '07:00', status: 'attended', createdAt: '2026-05-17T18:00:00.000Z' },
        { bookingId: 'b_may_11', classId: 'mon_3', className: 'Ashtanga Yoga', instructor: 'Camila', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-05-18', classTime: '10:00', status: 'attended', createdAt: '2026-05-17T19:00:00.000Z' },
        { bookingId: 'b_may_12', classId: 'wed_5', className: 'Vinyasa Pro', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-05-20', classTime: '19:00', status: 'cancelled', createdAt: '2026-05-19T10:00:00.000Z' },
        { bookingId: 'b_may_13', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-05-22', classTime: '07:00', status: 'attended', createdAt: '2026-05-21T08:00:00.000Z' },
        { bookingId: 'b_may_14', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_demo', studentName: 'Joaquín V.', studentEmail: 'joaquinvillanuevavarela@gmail.com', classDate: '2026-05-22', classTime: '07:00', status: 'attended', createdAt: '2026-05-21T09:00:00.000Z' },
        { bookingId: 'b_may_15', classId: 'mon_2', className: 'Hatha Tradicional', instructor: 'Matías', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-05-25', classTime: '08:30', status: 'attended', createdAt: '2026-05-24T14:00:00.000Z' },
        { bookingId: 'b_may_16', classId: 'wed_4', className: 'Restaurativo & Yin', instructor: 'Lucas', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-05-27', classTime: '17:30', status: 'attended', createdAt: '2026-05-26T09:00:00.000Z' },
        { bookingId: 'b_may_17', classId: 'fri_4', className: 'Yin & Sonidos Sagrados', instructor: 'Lucas', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-05-29', classTime: '17:30', status: 'attended', createdAt: '2026-05-28T11:00:00.000Z' },
        { bookingId: 'b_may_18', classId: 'sat_2', className: 'Vinyasa Weekend', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-05-30', classTime: '10:00', status: 'cancelled', createdAt: '2026-05-29T12:00:00.000Z' },

        // ================= JUNE 2026 (PAST SESSIONS) =================
        { bookingId: 'b_jun_1', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-06-01', classTime: '07:00', status: 'attended', createdAt: '2026-05-31T18:00:00.000Z' },
        { bookingId: 'b_jun_2', classId: 'mon_3', className: 'Ashtanga Yoga', instructor: 'Camila', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-06-01', classTime: '10:00', status: 'attended', createdAt: '2026-05-31T19:00:00.000Z' },
        { bookingId: 'b_jun_3', classId: 'wed_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-06-03', classTime: '07:00', status: 'attended', createdAt: '2026-06-02T20:00:00.000Z' },
        { bookingId: 'b_jun_4', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-06-05', classTime: '07:00', status: 'attended', createdAt: '2026-06-04T08:00:00.000Z' },
        { bookingId: 'b_jun_5', classId: 'fri_5', className: 'Meditación Guiada', instructor: 'Lucas', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-06-05', classTime: '19:00', status: 'cancelled', createdAt: '2026-06-04T09:00:00.000Z' },
        { bookingId: 'b_jun_6', classId: 'sat_2', className: 'Vinyasa Weekend', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-06-06', classTime: '10:00', status: 'attended', createdAt: '2026-06-05T11:00:00.000Z' },
        { bookingId: 'b_jun_7', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-06-08', classTime: '07:00', status: 'attended', createdAt: '2026-06-07T18:00:00.000Z' },
        { bookingId: 'b_jun_8', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_demo', studentName: 'Joaquín V.', studentEmail: 'joaquinvillanuevavarela@gmail.com', classDate: '2026-06-08', classTime: '07:00', status: 'attended', createdAt: '2026-06-07T19:00:00.000Z' },
        { bookingId: 'b_jun_9', classId: 'wed_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-06-10', classTime: '07:00', status: 'attended', createdAt: '2026-06-09T10:00:00.000Z' },
        { bookingId: 'b_jun_10', classId: 'wed_4', className: 'Restaurativo & Yin', instructor: 'Lucas', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-06-10', classTime: '17:30', status: 'attended', createdAt: '2026-06-09T14:00:00.000Z' },
        { bookingId: 'b_jun_11', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-06-12', classTime: '07:00', status: 'attended', createdAt: '2026-06-11T08:00:00.000Z' },
        { bookingId: 'b_jun_12', classId: 'sat_1', className: 'Ashtanga Pro Sábado', instructor: 'Camila', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-06-13', classTime: '08:30', status: 'attended', createdAt: '2026-06-12T15:00:00.000Z' },
        { bookingId: 'b_jun_13', classId: 'sat_1', className: 'Ashtanga Pro Sábado', instructor: 'Camila', studentId: 'student_demo', studentName: 'Joaquín V.', studentEmail: 'joaquinvillanuevavarela@gmail.com', classDate: '2026-06-13', classTime: '08:30', status: 'attended', createdAt: '2026-06-12T16:00:00.000Z' },

        // ================= JUNE 2026 (FUTURE BOOKED SESSIONS) =================
        { bookingId: 'b_fut_10', classId: 'mon_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-06-15', classTime: '07:00', status: 'booked', createdAt: '2026-06-14T18:00:00.000Z' },
        { bookingId: 'b_fut_11', classId: 'wed_5', className: 'Vinyasa Pro', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-06-17', classTime: '19:00', status: 'booked', createdAt: '2026-06-14T19:00:00.000Z' },
        { bookingId: 'b_fut_12', classId: 'wed_1', className: 'Vinyasa Flow', instructor: 'Sofía', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-06-17', classTime: '07:00', status: 'booked', createdAt: '2026-06-14T20:00:00.000Z' },
        { bookingId: 'b_fut_13', classId: 'thu_3', className: 'Yin Yoga', instructor: 'Lucas', studentId: 'student_lucia', studentName: 'Lucía G.', studentEmail: 'lucia@gmail.com', classDate: '2026-06-18', classTime: '10:00', status: 'booked', createdAt: '2026-06-14T21:00:00.000Z' },
        { bookingId: 'b_fut_14', classId: 'fri_1', className: 'Vinyasa Energizante', instructor: 'Sofía', studentId: 'student_mateo', studentName: 'Mateo R.', studentEmail: 'mateo@gmail.com', classDate: '2026-06-19', classTime: '07:00', status: 'booked', createdAt: '2026-06-14T22:00:00.000Z' },
        { bookingId: 'b_fut_15', classId: 'sat_4', className: 'Relajación Profunda', instructor: 'Lucas', studentId: 'student_clara', studentName: 'Clara S.', studentEmail: 'clara@gmail.com', classDate: '2026-06-20', classTime: '15:00', status: 'booked', createdAt: '2026-06-14T23:00:00.000Z' }
      ];

      // 5. Rich Operating Financial Expenses (Standard rent, salaries, basic services/wifi, advertising and supplies)
      const expensesToSeed: Expense[] = [
        // April (Abril 2026)
        { expenseId: 'exp_val_apr_1', amount: 350000, category: 'arriendo', description: 'Arriendo mensual del salón principal San Miguel (Abril)', date: '2026-04-05', createdAt: '2026-04-05T09:00:00.000Z' },
        { expenseId: 'exp_val_apr_2', amount: 260000, category: 'sueldos', description: 'Pago de sueldos honorarios instructores (Abril)', date: '2026-04-28', createdAt: '2026-04-28T18:00:00.000Z' },
        { expenseId: 'exp_val_apr_3', amount: 46200, category: 'generales', description: 'Gastos básicos generales de agua, luz y wifi (Abril)', date: '2026-04-15', createdAt: '2026-04-15T11:00:00.000Z' },
        { expenseId: 'exp_val_apr_4', amount: 15000, category: 'otros', description: 'Compra de insumos sanitizantes y desinfectantes ecológicos', date: '2026-04-18', createdAt: '2026-04-18T10:00:00.000Z' },

        // May (Mayo 2026)
        { expenseId: 'exp_val_may_1', amount: 350000, category: 'arriendo', description: 'Arriendo mensual del salón principal San Miguel (Mayo)', date: '2026-05-05', createdAt: '2026-05-05T09:00:00.000Z' },
        { expenseId: 'exp_val_may_2', amount: 250000, category: 'sueldos', description: 'Pago de sueldos honorarios instructores (Mayo)', date: '2026-05-28', createdAt: '2026-05-28T18:00:00.000Z' },
        { expenseId: 'exp_val_may_3', amount: 45000, category: 'generales', description: 'Gastos de luz, agua e internet (Mayo)', date: '2026-05-15', createdAt: '2026-05-15T11:00:00.000Z' },
        { expenseId: 'exp_val_may_4', amount: 75000, category: 'otros', description: 'Renovación de 3 mats de yoga antideslizantes de caucho natural', date: '2026-05-24', createdAt: '2026-05-24T14:30:00.000Z' },
        { expenseId: 'exp_val_may_5', amount: 20000, category: 'otros', description: 'Campaña publicitaria básica en Instagram de invierno', date: '2026-05-10', createdAt: '2026-05-10T12:00:00.000Z' },

        // June (Junio 2026)
        { expenseId: 'exp_val_jun_1', amount: 350000, category: 'arriendo', description: 'Arriendo mensual del salón principal San Miguel (Junio)', date: '2026-06-05', createdAt: '2026-06-05T09:00:00.000Z' },
        { expenseId: 'exp_val_jun_2', amount: 180000, category: 'sueldos', description: 'Pago de honorarios y bonos semanales acumulados instructores (Junio)', date: '2026-06-12', createdAt: '2026-06-12T18:00:00.000Z' },
        { expenseId: 'exp_val_jun_3', amount: 52000, category: 'generales', description: 'Gastos comunes de edificio, consumos básicos y wifi (Junio)', date: '2026-06-10', createdAt: '2026-06-10T11:00:00.000Z' },
        { expenseId: 'exp_val_jun_4', amount: 12000, category: 'otros', description: 'Flores frescas de loto e sahumerios para la recepción', date: '2026-06-08', createdAt: '2026-06-08T10:00:00.000Z' }
      ];

      if (isMock) {
        // --- SANDBOX OVERWRITE ---
        localStorage.setItem(LS_KEYS.USERS, JSON.stringify(usersToSeed));
        localStorage.setItem(LS_KEYS.PACKAGES, JSON.stringify(packagesToSeed));
        localStorage.setItem('yoga_studio_classes', JSON.stringify(classesToSeed));
        localStorage.setItem(LS_KEYS.BOOKINGS, JSON.stringify(mockBookingsToSeed));
        localStorage.setItem('yoga_studio_expenses', JSON.stringify(expensesToSeed));
        
        count = Object.keys(usersToSeed).length + packagesToSeed.length + classesToSeed.length + mockBookingsToSeed.length + expensesToSeed.length;
      } else {
        // --- FIRESTORE MASS WRITE ---
        // Overwrite Users
        for (const [userId, user] of Object.entries(usersToSeed)) {
          try {
            await setDoc(doc(db, 'users', userId), user);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
          }
        }
        // Overwrite Packages
        for (const pkg of packagesToSeed) {
          try {
            await setDoc(doc(db, 'packages', pkg.packageId), pkg);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `packages/${pkg.packageId}`);
          }
        }
        // Overwrite Classes
        for (const cls of classesToSeed) {
          try {
            await setDoc(doc(db, 'classes', cls.classId), cls);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `classes/${cls.classId}`);
          }
        }
        // Overwrite Bookings
        for (const booking of mockBookingsToSeed) {
          try {
            await setDoc(doc(db, 'bookings', booking.bookingId), booking);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `bookings/${booking.bookingId}`);
          }
        }
        // Overwrite Expenses
        for (const exp of expensesToSeed) {
          try {
            await setDoc(doc(db, 'expenses', exp.expenseId), exp);
            count++;
          } catch (error) {
            handleFirestoreError(error, OperationType.WRITE, `expenses/${exp.expenseId}`);
          }
        }
      }

      return { success: true, count };
    } catch (e: any) {
      console.error("Database seed reset failed:", e);
      return { success: false, count: 0, error: e.message || String(e) };
    }
  }
};

