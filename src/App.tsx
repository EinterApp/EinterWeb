import { useState } from 'react'
import { useAuth } from './context/AuthContext'
import { DarkModeProvider } from './context/DarkModeContext'
import { Sidebar } from './components/Sidebar'
import { Navbar } from './components/NavBar'
import { Login } from './pages/Login'
import { Home } from './pages/Home'
import { Productos } from './pages/Productos'
import { Proveedores } from './pages/Proveedores'
import { Ubicaciones } from './pages/Ubicaciones'
import { Movimientos } from './pages/Movimientos'
import { Ventas } from './pages/Ventas'
import { Recibos } from './pages/Recibos'
import { InventarioInteligente } from './pages/InventarioInteligente'
import { Perfiles } from './pages/Perfiles'
import { Categorias } from './pages/Categorias'
import Profile from './components/Profile'
import { UserManagement } from './pages/UserManagement'
import { RoleGuard } from './components/RoleGuard'

function App() {
  const { user, loading } = useAuth()
  const [currentPage, setCurrentPage] = useState('home')

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <Home />
      case 'productos':
        return <Productos />
      case 'proveedores':
        return <Proveedores/>
      case 'ubicaciones':
        return <Ubicaciones/>
      case 'movimientos':
        return <Movimientos/>
      case 'ventas':
        return <Ventas/>
      case 'recibos':
        return <Recibos/>
      case 'inventario-inteligente':
        return <InventarioInteligente />
      case 'categorias':
        return <Categorias/>
      case 'perfiles':
        return <Perfiles/>
      case 'profile':
        return <Profile />
      case 'users':
        return (
          <RoleGuard
            requireSuperAdmin={true}
            fallback={
              <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-red-600 mb-2">Acceso Denegado</h2>
                  <p className="text-gray-600">No tienes permisos para acceder a esta página.</p>
                </div>
              </div>
            }
          >
            <UserManagement />
          </RoleGuard>
        )
      default:
        return <Home />
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl text-gray-600">Cargando...</div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <DarkModeProvider>
      <div className="flex flex-col min-h-screen transition-colors duration-300">
        <Navbar onNavigateToProfile={() => setCurrentPage('profile')} />
        <div className="flex flex-1 pt-16">
          <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />
          <main className="flex-1 md:ml-64 transition-all duration-300">
            {renderPage()}
          </main>
        </div>
      </div>
    </DarkModeProvider>
  )
}

export default App

