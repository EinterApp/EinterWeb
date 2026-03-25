import type { UserRole } from './roles';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

// Store the current Firebase ID token
let currentIdToken: string | null = null;

export function setAuthToken(token: string | null) {
  currentIdToken = token;
}

export function getAuthToken(): string | null {
  return currentIdToken;
}

// Backend user response
export interface BackendUserData {
  uid: string;
  email: string;
  role: UserRole;
  displayName?: string;
  photoURL?: string;
  [key: string]: any;
}

// Login to backend after Firebase authentication
export async function loginToBackend(idToken: string): Promise<BackendUserData> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Backend authentication failed');
  }

  const data = await response.json();
  return data.user || data;
}

// Get current user from backend
export async function getCurrentUser(): Promise<BackendUserData> {
  if (!currentIdToken) {
    throw new Error('No authentication token available');
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${currentIdToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to get user data');
  }

  const data = await response.json();
  return data.user || data;
}

// Generic API request helper with authentication
export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (currentIdToken) {
    headers['Authorization'] = `Bearer ${currentIdToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// Specific API methods for your app
export const api = {
  // Auth
  login: loginToBackend,
  getCurrentUser,

  // Productos
  getProductos: () => apiRequest('/api/productos'),
  createProducto: (data: any) => apiRequest('/api/productos', {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  updateProducto: (id: string, data: any) => apiRequest(`/api/productos/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  deleteProducto: (id: string) => apiRequest(`/api/productos/${id}`, {
    method: 'DELETE'
  }),

  // Proveedores
  getProveedores: () => apiRequest('/api/proveedores'),
  createProveedor: (data: any) => apiRequest('/api/proveedores', {
    method: 'POST',
    body: JSON.stringify(data)
  }),

  // User management (SuperAdmin only - via auth router)
  getAllUsers: () => apiRequest<BackendUserData[]>('/api/auth/users'),
  updateUserRole: (id: string, role: UserRole) => apiRequest(`/api/auth/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ rol: role })
  }),
  toggleUserActive: (id: string, isActive: boolean) => apiRequest(`/api/auth/users/${id}/toggle-active`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: isActive })
  }),

  // Add more endpoints as needed
};
