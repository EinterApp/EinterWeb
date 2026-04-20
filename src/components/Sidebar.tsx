import { useState } from 'react'
import { useDarkMode } from '../context/DarkModeContext'
import { useRole } from '../hooks/useRole'

interface SidebarProps {
  currentPage: string
  onNavigate: (page: string) => void
}

export function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const [isOpen, setIsOpen] = useState(true)
  const { darkMode, toggleDarkMode } = useDarkMode()
  const { isSuperAdmin } = useRole()

  const menuItems = [
    { id: 'home', label: 'Home', icon: '🏠' },
    { id: 'productos', label: 'Productos', icon: '🛒' },
    { id: 'proveedores', label: 'Proveedores', icon: '🚚' },
    { id: 'ubicaciones', label: 'Ubicaciones', icon: '📍' },
    { id: 'movimientos', label: 'Movimientos', icon: '🔄' },
    { id: 'ventas', label: 'Ventas', icon: '💰' },
    { id: 'recibos', label: 'Recibos', icon: '🧾' },
    { id: 'inventario-inteligente', label: 'Inv. Inteligente', icon: '🧠' },
    { id: 'pedido-personalizado', label: 'Pedido Custom', icon: '📦' },
    { id: 'categorias', label: 'Categorías', icon: '📂' },
    { id: 'perfiles', label: 'Perfiles', icon: '👤' },
    ...(isSuperAdmin ? [{ id: 'users', label: 'Usuarios', icon: '👥' }] : []),
  ]

  return (
    <>
      {/* Mobile Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 md:hidden bg-blue-500 dark:bg-blue-600 text-white p-2 rounded-lg shadow-lg hover:bg-blue-600 dark:hover:bg-blue-700 transition-all"
      >
        {isOpen ? '✕' : '☰'}
      </button>

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full bg-white dark:bg-gray-900 shadow-xl transition-all duration-300 ease-in-out z-40 ${
          isOpen ? 'w-64' : 'w-0 md:w-20'
        }`}
      >
        <div className={`h-full flex flex-col ${isOpen ? 'p-6' : 'p-0 md:p-4'} overflow-hidden`}>
          {/* Header */}
          <div className="mb-8 animate-fade-in">
            <h1
              className={`font-bold text-blue-600 dark:text-blue-400 transition-all duration-300 ${
                isOpen ? 'text-2xl' : 'text-lg text-center'
              }`}
            >
              {isOpen ? 'BodegaEinter' : 'BE'}
            </h1>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-2">
            {menuItems.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 hover:scale-105 ${
                  currentPage === item.id
                    ? 'bg-blue-500 dark:bg-blue-600 text-white shadow-lg'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
                style={{
                  animationDelay: `${index * 100}ms`,
                  animation: 'slideIn 0.3s ease-out forwards',
                }}
              >
                <span className="text-xl">{item.icon}</span>
                {isOpen && <span className="font-medium">{item.label}</span>}
              </button>
            ))}
          </nav>

          {/* Dark Mode Toggle */}
          <div className="mt-auto pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={toggleDarkMode}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all duration-200 hover:scale-105 ${
                !isOpen && 'justify-center'
              }`}
            >
              <span className="text-xl">{darkMode ? '☀️' : '🌙'}</span>
              {isOpen && (
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {darkMode ? 'Light Mode' : 'Dark Mode'}
                </span>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
