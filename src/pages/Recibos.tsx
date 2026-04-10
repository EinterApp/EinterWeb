import { useState, useEffect } from "react";
import { ReciboModal } from "../components/ReciboModal";
import type { ReciboData } from "../components/ReciboModal";
import { useDarkMode } from "../context/DarkModeContext";

interface Recibo {
  id_recibo: number;
  proveedor: string | null;
  id_orden: number | null;
  precio: number;
  fecha_compra: string;
  fecha_llegada: string | null;
  recibido: boolean;
  pdf_data: string | null;
  pdf_filename: string | null;
}

interface RecibosResponse {
  items: Recibo[];
  page: number;
  pageSize: number;
  total: number;
}

export function Recibos() {
  useDarkMode();
  const [recibos, setRecibos] = useState<Recibo[]>([]);
  const [filteredRecibos, setFilteredRecibos] = useState<Recibo[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    pageSize: 20,
  });
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedRecibo, setSelectedRecibo] = useState<ReciboData | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");

  // Fetch recibos from API
  useEffect(() => {
    fetchRecibos();
  }, []);

  const fetchRecibos = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = (await fetchAPI(`/api/odoo/recibos`)) as RecibosResponse;
      setRecibos(response.items);
      setFilteredRecibos(response.items);
      setPagination({
        total: response.total,
        totalPages: Math.ceil(response.total / response.pageSize),
        pageSize: response.pageSize,
      });
    } catch (err) {
      console.error("Error fetching recibos:", err);
      setError("Error al cargar los recibos");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (text: string) => {
    setSearchText(text);
    filterRecibos(text);
  };

  const filterRecibos = (search: string) => {
    let filtered = recibos;

    if (search) {
      filtered = filtered.filter(
        (recibo) =>
          recibo.proveedor?.toLowerCase().includes(search.toLowerCase()) ||
          recibo.id_orden?.toString().includes(search)
      );
    }

    setFilteredRecibos(filtered);
  };

  const handleOpenPdf = (reciboId: number) => {
    window.open(`/api/recibos/${reciboId}/pdf`, "_blank");
  };

  const handleOpenCreateModal = () => {
    setSelectedRecibo(null);
    setModalMode("create");
    setModalVisible(true);
  };

  // @ts-expect-error - Unused function kept for future implementation
  const _handleOpenEditModal = (recibo: Recibo) => {
    const reciboData: ReciboData = {
      orden: recibo.id_orden?.toString() || "",
      proveedor_id: 0, // Will need to be resolved
      tipo: 1, // Default to "Compra"
      fecha_compra: recibo.fecha_compra,
      eta: recibo.fecha_llegada || "",
      productos: [],
    };
    setSelectedRecibo(reciboData);
    setModalMode("edit");
    setModalVisible(true);
  };

  const handleCloseModal = () => {
    setModalVisible(false);
    setSelectedRecibo(null);
  };

  const handleSaveRecibo = async (reciboData: ReciboData) => {
    try {
      const payload = {
        proveedor: reciboData.proveedor_name || null,
        id_orden: reciboData.orden ? parseInt(reciboData.orden) : null,
        precio: reciboData.productos.reduce(
          (sum, p) => sum + p.costo_por_articulo * p.cantidad,
          0
        ),
        fecha_compra: reciboData.fecha_compra,
        fecha_llegada: reciboData.eta || null,
        recibido: false,
        pdf: reciboData.pdf || null, // Include PDF Base64 string
      };

      if (modalMode === "create") {
        await fetchAPI("/(api)/recibos", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      } else if (modalMode === "edit" && selectedRecibo) {
        // For edit mode, we need the id_recibo
        // This will require updating the selectedRecibo state structure
        await fetchAPI(`/(api)/recibos/${selectedRecibo.orden}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }

      // Refresh the recibos list
      await fetchRecibos();
    } catch (err) {
      throw err;
    }
  };


  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  };

  const WebView = (
    <div className="w-full bg-gray-50 dark:bg-gray-900 flex flex-col min-h-screen">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-wide text-gray-900 dark:text-white">
            Recibos
          </h1>
          <div className="flex gap-3">
            <button
              onClick={handleOpenCreateModal}
              className="px-6 py-2 border border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors text-sm font-medium text-gray-900 dark:text-white"
            >
              + Agregar Recibo
            </button>
          </div>
        </div>

        <div className="flex items-center mt-4">
          <div className="flex-1 relative">
            <input
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Buscar"
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
            />
            <div className="absolute right-3 top-3">
              <span className="text-gray-400 dark:text-gray-500">🔍</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-gray-800 mx-8 mt-4 border border-gray-400 dark:border-gray-700 overflow-hidden flex flex-col rounded-lg">
        <div className="flex bg-gray-100 dark:bg-gray-700 border-b-2 border-gray-400 dark:border-gray-600">
          <div className="w-12 py-4 px-2 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="text-gray-500 dark:text-gray-400">🔽</span>
          </div>
          <div className="flex-2 py-4 px-4 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-700 dark:text-gray-300 text-base text-center">
              Proveedor
            </span>
          </div>
          <div className="flex-[1.5] py-4 px-4 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-700 dark:text-gray-300 text-base text-center">
              Numero Orden
            </span>
          </div>
          <div className="flex-1 py-4 px-4 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-700 dark:text-gray-300 text-base text-center">
              Precio
            </span>
          </div>
          <div className="flex-[1.5] py-4 px-4 border-r border-gray-400 dark:border-gray-600 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-700 dark:text-gray-300 text-base text-center">
              Fecha Compra
            </span>
          </div>
          <div className="flex-[1.5] py-4 px-4 border-r border-gray-400 flex items-center justify-center">
            <span className="font-robotoMedium text-gray-700 text-base text-center">
              Fecha Recibir
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex-1 items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-500 font-robotoRegular mt-4">
                Cargando recibos...
              </p>
            </div>
          ) : error ? (
            <div className="flex-1 items-center justify-center py-20">
              <p className="text-red-500 font-robotoRegular">{error}</p>
              <button
                onClick={fetchRecibos}
                className="mt-4 bg-blue-600 px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                <span className="text-white font-robotoMedium">Reintentar</span>
              </button>
            </div>
          ) : filteredRecibos.length === 0 ? (
            <div className="flex-1 items-center justify-center py-20">
              <p className="text-gray-500 font-robotoRegular">
                No hay recibos disponibles
              </p>
            </div>
          ) : (
            filteredRecibos.map((recibo, index) => (
              <div
                key={recibo.id_recibo}
                className={`flex border-b border-gray-300 ${index % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
              >
                <div className="w-12 py-4 px-2 border-r border-gray-300 flex items-center justify-center">
                  {recibo.pdf_data ? (
                    <button
                      onClick={() => handleOpenPdf(recibo.id_recibo)}
                      className="text-gray-600 hover:text-blue-600 text-xl cursor-pointer transition-colors"
                      title="Descargar PDF"
                    >
                      📄
                    </button>
                  ) : (
                    <span className="text-gray-300 text-xl">📄</span>
                  )}
                </div>
                <div className="flex-2 py-4 px-4 border-r border-gray-300 flex items-center justify-center">
                  <span className="font-robotoRegular text-gray-900 text-sm text-center">
                    {recibo.proveedor || "N/A"}
                  </span>
                </div>
                <div className="flex-[1.5] py-4 px-4 border-r border-gray-300 flex items-center justify-center">
                  <span className="font-robotoRegular text-gray-900 text-sm text-center">
                    {recibo.id_orden || "N/A"}
                  </span>
                </div>
                <div className="flex-1 py-4 px-4 border-r border-gray-300 flex items-center justify-center">
                  <span className="font-robotoRegular text-gray-900 text-sm text-center">
                    {recibo.precio
                      ? `$${Number(recibo.precio).toFixed(2)}`
                      : "N/A"}
                  </span>
                </div>
                <div className="flex-[1.5] py-4 px-4 border-r border-gray-300 flex items-center justify-center">
                  <span className="font-robotoRegular text-gray-900 text-sm text-center">
                    {formatDate(recibo.fecha_compra)}
                  </span>
                </div>
                <div className="flex-[1.5] py-4 px-4 border-r border-gray-300 flex items-center justify-center">
                  <span className="font-robotoRegular text-gray-900 text-sm text-center">
                    {formatDate(recibo.fecha_llegada)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {WebView}
      <ReciboModal
        visible={modalVisible}
        recibo={selectedRecibo}
        onClose={handleCloseModal}
        onSave={handleSaveRecibo}
        mode={modalMode}
      />
    </>
  );
}