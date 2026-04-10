import { useState, useEffect } from "react";
import { VentaModal } from "../components/VentaModal";
import type { OrdenVenta } from "../components/VentaModal";
import { useDarkMode } from "../context/DarkModeContext";
import { fetchAPI } from "../lib/fetch";

interface Venta {
  id_venta: number;
  id_orden: string | number | null;
  cliente: string | null;
  total: number | string;
  fecha: string | Date;
  pdf_data: string | null;
  pdf_filename: string | null;
}

interface VentasResponse {
  page: number;
  pageSize: number;
  total: number;
  items: Venta[];
}

export function Ventas() {
  useDarkMode();
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [filteredVentas, setFilteredVentas] = useState<Venta[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedOrden, setSelectedOrden] = useState<OrdenVenta | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");

  // Fetch ventas from API
  useEffect(() => {
    const fetchVentas = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = (await fetchAPI(
          `/api/odoo/ventas?page=${page}&pageSize=${pageSize}`
        )) as VentasResponse;

        setVentas(response.items);
        setFilteredVentas(response.items);
        setTotal(response.total);
      } catch (err) {
        setError((err as Error).message);
        console.error("Error fetching ventas:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchVentas();
  }, [page, pageSize]);

  // @ts-expect-error - Unused function kept for future implementation
  const _handleSearch = (text: string) => {
    setSearchText(text);
    const filtered = ventas.filter(
      (venta) =>
        venta.id_orden?.toString().toLowerCase().includes(text.toLowerCase()) ||
        false ||
        venta.cliente?.toLowerCase().includes(text.toLowerCase()) ||
        false
    );
    setFilteredVentas(filtered);
  };

  const formatDate = (dateValue: string | Date) => {
    const date = new Date(dateValue);
    return date.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const formatCurrency = (value: number | string) => {
    return `$${Number(value).toFixed(2)}`;
  };

  const handleOpenPdf = (ventaId: number) => {
    window.open(`/api/ventas/${ventaId}/pdf`, "_blank");
  };

  const handleOpenCreateModal = () => {
    setSelectedOrden(null);
    setModalMode("create");
    setModalVisible(true);
  };

  // @ts-expect-error - Unused function kept for future implementation
  const _handleOpenEditModal = (_venta: Venta) => {
    // TODO: Convert venta to OrdenVenta structure
    // setSelectedOrden(venta);
    // setModalMode("edit");
    // setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setSelectedOrden(null);
  };

  const handleSaveOrden = async (ordenData: OrdenVenta) => {
    try {
      const items = [];
      for (const folio of ordenData.folios) {
        for (const producto of folio.productos) {
          items.push({
            id_articulo: parseInt(producto.id),
            cantidad: producto.cantidad,
            numero_folio: folio.numero_folio,
          });
        }
      }

      // Calculate total price
      const total = ordenData.folios.reduce((sum, folio) => {
        return sum + folio.productos.reduce((folioSum, producto) => {
          return folioSum + (producto.cantidad * producto.precio);
        }, 0);
      }, 0);

      // POST the order data to the API
      const payload = {
        id_orden: ordenData.id_orden,
        cliente: ordenData.cliente,
        fecha: ordenData.fecha,
        total: total,
        items: items,
        pdf: ordenData.pdf || null,
      };

      await fetchAPI(`/(api)/ventas`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Refresh the ventas list
      const response = (await fetchAPI(
        `/api/odoo/ventas?page=${page}&pageSize=${pageSize}`
      )) as VentasResponse;

      setVentas(response.items);
      setFilteredVentas(response.items);
      setTotal(response.total);
    } catch (err) {
      console.error("❌ Error al guardar:", err);
      
      throw err;
    }
  };

  const WebView = (
    <div className="w-full bg-gray-50 dark:bg-gray-900 flex flex-col min-h-screen">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-3xl font-bold tracking-wide text-gray-900 dark:text-white">
            Ventas
          </h1>
          <div className="flex gap-3">
            <button
              onClick={handleOpenCreateModal}
              className="px-6 py-2 border border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors text-sm font-medium text-gray-900 dark:text-white"
            >
              + Agregar Venta
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-gray-800 mx-8 mt-4 border border-gray-400 dark:border-gray-700 overflow-hidden flex flex-col rounded-lg">
        <div className="flex bg-gray-100 dark:bg-gray-700 border-b-2 border-gray-400 dark:border-gray-600">
          <div className="w-12 py-4 px-2 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="text-gray-700 dark:text-gray-300 font-bold text-sm" title="PDF disponible">📄</span>
          </div>
          <div className="flex-[1.5] py-4 px-3 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-900 dark:text-white text-xl text-center">
              Numero Orden
            </span>
          </div>
          <div className="flex-2 py-4 px-3 border-r border-gray-400 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-900 text-xl text-center">
              Cliente
            </span>
          </div>
          <div className="flex-[1.2] py-4 px-3 border-r border-gray-400 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-900 text-xl text-center">
              Total
            </span>
          </div>
          <div className="flex-[1.2] py-4 px-3 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-900 text-xl text-center">
              Fecha
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex-1 items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 font-robotoRegular mt-4">
                Cargando ventas...
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 items-center justify-center py-20">
              <p className="text-red-500 font-robotoMedium">
                Error al cargar ventas
              </p>
              <p className="text-gray-400 font-robotoRegular text-sm mt-2">
                {error}
              </p>
            </div>
          ) : filteredVentas.length === 0 ? (
            <div className="flex-1 items-center justify-center py-20">
              <p className="text-gray-500 font-robotoRegular">
                No hay ventas disponibles
              </p>
              {searchText && (
                <p className="text-gray-400 font-robotoRegular text-sm mt-2">
                  No se encontraron resultados para "{searchText}"
                </p>
              )}
            </div>
          ) : (
            filteredVentas.map((venta, index) => (
              <div
                key={venta.id_venta}
                className={`flex border-b border-gray-300 ${
                  index % 2 === 0 ? "bg-white" : "bg-gray-50"
                } hover:bg-blue-50`}
              >
                <div className="w-12 py-4 px-2 border-r border-gray-300 flex items-center justify-center">
                  {venta.pdf_data ? (
                    <button
                      onClick={() => handleOpenPdf(venta.id_venta)}
                      className="text-blue-600 hover:text-blue-800 hover:scale-110 text-lg cursor-pointer transition-all font-bold"
                      title="Descargar PDF"
                    >
                      📄
                    </button>
                  ) : (
                    <span className="text-gray-300 text-lg">📄</span>
                  )}
                </div>
                <div className="flex-[1.5] py-4 px-3 border-r border-gray-300 flex items-center justify-center">
                  <span className="text-gray-900 font-robotoRegular text-base text-center">
                    {venta.id_orden || "—"}
                  </span>
                </div>

                <div className="flex-2 py-4 px-3 border-r border-gray-300 flex items-center justify-center">
                  <span
                    className="text-gray-900 font-robotoRegular text-base text-center truncate"
                    title={venta.cliente || ""}
                  >
                    {venta.cliente || "—"}
                  </span>
                </div>

                <div className="flex-[1.2] py-4 px-3 border-r border-gray-300 flex items-center justify-center">
                  <span className="text-gray-900 font-robotoRegular text-base text-center">
                    {formatCurrency(venta.total)}
                  </span>
                </div>

                <div className="flex-[1.2] py-4 px-3 flex items-center justify-center">
                  <span className="text-gray-900 font-robotoRegular text-base text-center">
                    {formatDate(venta.fecha)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {!loading && !error && total > 0 && (
          <div className="flex-row items-center justify-between px-6 py-4 border-t border-gray-200">
            <span className="text-gray-600 font-robotoRegular">
              Mostrando {(page - 1) * pageSize + 1} -{" "}
              {Math.min(page * pageSize, total)} de {total} ventas
            </span>
            <div className="flex-row gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className={`px-4 py-2 rounded-lg ${page === 1 ? "bg-gray-200" : "bg-blue-600"}`}
              >
                <span
                  className={`font-robotoMedium ${page === 1 ? "text-gray-400" : "text-white"}`}
                >
                  Anterior
                </span>
              </button>
              <span className="px-4 py-2 font-robotoMedium text-gray-700">
                Página {page} de {Math.ceil(total / pageSize)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= Math.ceil(total / pageSize)}
                className={`px-4 py-2 rounded-lg ${page >= Math.ceil(total / pageSize) ? "bg-gray-200" : "bg-blue-600"}`}
              >
                <span
                  className={`font-robotoMedium ${page >= Math.ceil(total / pageSize) ? "text-gray-400" : "text-white"}`}
                >
                  Siguiente
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {WebView}
      <VentaModal
        visible={modalVisible}
        orden={selectedOrden}
        onClose={handleCloseModal}
        onSave={handleSaveOrden}
        mode={modalMode}
      />
    </>
  );
}