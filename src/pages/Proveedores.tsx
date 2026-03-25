import { useState, useEffect, useCallback } from "react";
import { ProveedorModal } from "../components/ProveedorModal";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { useDarkMode } from "../context/DarkModeContext";

interface Proveedor {
  id: number;
  name: string;
  city: string;
  lead_time: number;
}

export function Proveedores() {
  useDarkMode();
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [filteredProveedores, setFilteredProveedores] = useState<Proveedor[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(
    null
  );

  // Delete modal states
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [proveedorToDelete, setProveedorToDelete] = useState<Proveedor | null>(
    null
  );
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Column filters
  const [filterName, setFilterName] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterLeadTime, setFilterLeadTime] = useState("");
  const [sortBy, setSortBy] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);

  // Fetch proveedores from database API
  const fetchProveedores = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchAPI(`/api/odoo/proveedores`);

      // Map Odoo raw DB fields to Proveedor type
      const mapped: Proveedor[] = (response.items || []).map((item: any) => ({
        id: item.id_proveedor,
        name: item.nombre,
        city: item.ciudad,
        lead_time: 0,
      }));

      setProveedores(mapped);
      setFilteredProveedores(mapped);
    } catch (err) {
      console.error("Error fetching proveedores from database:", err);
      setError(
        err instanceof Error ? err.message : "Error connecting to database"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProveedores();
  }, [fetchProveedores]);

  // Apply filters whenever filter states change
  const applyFilters = useCallback(() => {
    let filtered = [...proveedores];

    // Filter by name
    if (filterName.trim()) {
      filtered = filtered.filter((proveedor) =>
        proveedor.name.toLowerCase().includes(filterName.toLowerCase())
      );
    }

    // Filter by city
    if (filterCity.trim()) {
      filtered = filtered.filter((proveedor) =>
        proveedor.city?.toLowerCase().includes(filterCity.toLowerCase())
      );
    }

    // Filter by lead time
    if (filterLeadTime.trim()) {
      const leadTimeValue = parseInt(filterLeadTime);
      if (!isNaN(leadTimeValue)) {
        filtered = filtered.filter(
          (proveedor) => proveedor.lead_time === leadTimeValue
        );
      }
    }

    // Sort
    if (sortBy) {
      filtered.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortBy.column) {
          case "name":
            aValue = a.name.toLowerCase();
            bValue = b.name.toLowerCase();
            break;
          case "city":
            aValue = a.city?.toLowerCase() || "";
            bValue = b.city?.toLowerCase() || "";
            break;
          case "lead_time":
            aValue = a.lead_time || 0;
            bValue = b.lead_time || 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortBy.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortBy.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    setFilteredProveedores(filtered);
  }, [proveedores, filterName, filterCity, filterLeadTime, sortBy]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  const handleSort = (column: string) => {
    if (sortBy?.column === column) {
      // Toggle direction or clear sort
      if (sortBy.direction === "asc") {
        setSortBy({ column, direction: "desc" });
      } else {
        setSortBy(null);
      }
    } else {
      setSortBy({ column, direction: "asc" });
    }
  };

  const clearFilters = () => {
    setFilterName("");
    setFilterCity("");
    setFilterLeadTime("");
    setSortBy(null);
  };

  // Create proveedor
  const handleCreateProveedor = async (proveedorData: Partial<Proveedor>) => {
    try {
      // Map frontend fields to API expected fields
      const apiData = {
        nombre: proveedorData.name,
        ciudad: proveedorData.city,
        tiempo_envio: proveedorData.lead_time,
      };

      const result = await fetchAPI("/(api)/proveedores", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
      });

      // Sync to Odoo after creation
      if (result?.id) {
        try {
          await fetchAPI(`/api/odoo/sync/proveedor/${result.id}`, { method: "POST" });
        } catch (odooErr) {
          console.warn("Odoo sync failed (supplier will sync later):", odooErr);
        }
      }

      // Refresh the proveedor list
      await fetchProveedores();
    } catch (err) {
      throw err;
    }
  };

  // Update proveedor
  const handleUpdateProveedor = async (proveedorData: Partial<Proveedor>) => {
    try {
      // Map frontend fields to API expected fields
      const apiData: any = {};
      if (proveedorData.name !== undefined) apiData.nombre = proveedorData.name;
      if (proveedorData.city !== undefined) apiData.ciudad = proveedorData.city;
      if (proveedorData.lead_time !== undefined)
        apiData.tiempo_envio = proveedorData.lead_time;

      await fetchAPI(`/(api)/proveedores?id=${proveedorData.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
      });

      // Sync to Odoo after update
      if (proveedorData.id) {
        try {
          await fetchAPI(`/api/odoo/sync/proveedor/${proveedorData.id}`, { method: "POST" });
        } catch (odooErr) {
          console.warn("Odoo sync failed (supplier will sync later):", odooErr);
        }
      }

      // Refresh the proveedor list
      await fetchProveedores();
    } catch (err) {
      throw err;
    }
  };

  // Delete proveedor
  const handleDeleteProveedor = async () => {
    if (!proveedorToDelete) return;

    setDeleteLoading(true);
    try {
      await fetchAPI(`/(api)/proveedores?id=${proveedorToDelete.id}`, {
        method: "DELETE",
      });

      setDeleteModalVisible(false);
      setProveedorToDelete(null);

      // Refresh the proveedor list
      await fetchProveedores();
    } catch (err) {
      console.error("Error deleting proveedor:", err);
      setError(err instanceof Error ? err.message : "Error deleting proveedor");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Open modal for creating
  const openCreateModal = () => {
    setSelectedProveedor(null);
    setModalMode("create");
    setModalVisible(true);
  };

  // Open modal for editing
  const openEditModal = (proveedor: Proveedor) => {
    setSelectedProveedor(proveedor);
    setModalMode("edit");
    setModalVisible(true);
  };

  // Open delete confirmation
  const openDeleteModal = (proveedor: Proveedor) => {
    setProveedorToDelete(proveedor);
    setDeleteModalVisible(true);
  };

  const WebView = (
    <div className="w-full bg-gray-50 dark:bg-gray-900 flex flex-col min-h-screen">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-3xl font-bold tracking-wide text-gray-900 dark:text-white">
            Proveedores
          </h1>
          <button
            onClick={openCreateModal}
            className="px-6 py-2 border border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors text-sm font-medium text-gray-900 dark:text-white"
          >
            + Agregar Proveedor
          </button>
        </div>

        <div className="flex flex-row items-center mt-4 gap-3">
          {(filterName || filterCity || filterLeadTime || sortBy) && (
            <button
              onClick={clearFilters}
              className="bg-gray-200 dark:bg-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium"
            >
              Limpiar Filtros
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
            <p className="text-red-700 dark:text-red-300">Error: {error}</p>
            <button
              onClick={() => fetchProveedores()}
              className="mt-2 text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white dark:bg-gray-800 mx-8 mt-4 border border-gray-400 dark:border-gray-700 overflow-hidden flex flex-col rounded-lg">
        {/* Header with column names */}
        <div className="flex flex-row bg-gray-100 dark:bg-gray-700 border-b-2 border-gray-400 dark:border-gray-600">
          <div className="flex-3 py-4 px-4 border-r border-gray-400 dark:border-gray-600 flex justify-center items-center">
            <button
              onClick={() => handleSort("name")}
              className="flex flex-row items-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-xl text-center">
                Nombre del Proveedor
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "name"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-2 py-4 px-4 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("city")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-xl text-center">
                Ciudad
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "city"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.5] py-4 px-4 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("lead_time")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-xl text-center">
                Tiempo de Envío
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "lead_time"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.5] py-4 px-3 flex justify-center items-center">
            <h3 className="font-robotoMedium text-gray-900 text-xl text-center">
              Acciones
            </h3>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {loading && proveedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-500 font-robotoRegular mt-4">
                Cargando proveedores...
              </p>
            </div>
          ) : filteredProveedores.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-gray-500 font-robotoRegular">
                No se encontraron proveedores
              </p>
            </div>
          ) : (
            filteredProveedores.map((proveedor, index) => (
              <div
                key={proveedor.id}
                className={`flex flex-row border-b border-gray-300 ${
                  index % 2 === 0 ? "bg-white" : "bg-gray-50"
                }`}
              >
                <div className="flex-3 py-4 px-4 border-r border-gray-300 flex justify-center">
                  <p className="text-gray-900 font-robotoRegular text-lg text-center line-clamp-2">
                    {proveedor.name}
                  </p>
                </div>
                <div className="flex-2 py-4 px-4 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-lg text-center">
                    {proveedor.city || "—"}
                  </p>
                </div>
                <div className="flex-[1.5] py-4 px-4 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-lg text-center">
                    {proveedor.lead_time ? `${proveedor.lead_time}` : "—"}
                  </p>
                </div>
                <div className="flex-[1.5] py-2 px-2 flex justify-center items-center flex-row gap-2">
                  <button
                    onClick={() => openEditModal(proveedor)}
                    className="px-3 py-1.5 bg-blue-500 rounded hover:bg-blue-600 text-white text-xs font-robotoMedium"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => openDeleteModal(proveedor)}
                    className="px-3 py-1.5 bg-red-500 rounded hover:bg-red-600 text-white text-xs font-robotoMedium"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      <ProveedorModal
        visible={modalVisible}
        proveedor={selectedProveedor}
        mode={modalMode}
        onClose={() => {
          setModalVisible(false);
          setSelectedProveedor(null);
        }}
        onSave={
          modalMode === "create" ? handleCreateProveedor : handleUpdateProveedor
        }
      />

      <DeleteConfirmModal
        visible={deleteModalVisible}
        productName={proveedorToDelete?.name || ""}
        loading={deleteLoading}
        onConfirm={handleDeleteProveedor}
        onCancel={() => {
          setDeleteModalVisible(false);
          setProveedorToDelete(null);
        }}
      />
    </div>
  );

  return WebView;
}