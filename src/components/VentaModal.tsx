import { useState, useEffect, useRef } from "react";
import { fetchAPI } from "../lib/fetch";

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  cantidad: number;
  precio: number;
}

export interface Folio {
  id: string;
  numero_folio: string;
  productos: Producto[];
}

export interface OrdenVenta {
  id_orden: string;
  cliente: string;
  fecha: string;
  folios: Folio[];
  pdf?: string | null;
}

interface VentaModalProps {
  visible: boolean;
  orden: OrdenVenta | null;
  onClose: () => void;
  onSave: (orden: OrdenVenta) => Promise<void>;
  mode: "create" | "edit";
}

export function VentaModal({
  visible,
  orden,
  onClose,
  onSave,
  mode,
}: VentaModalProps) {
  const [formData, setFormData] = useState({
    id_orden: "",
    cliente: "",
    fecha: "",
  });
  const [folios, setFolios] = useState<Folio[]>([]);
  const [selectedFolioId, setSelectedFolioId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newFolioNumber, setNewFolioNumber] = useState("");
  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  
  // Estados para búsqueda de productos por SKU
  const [skuSearch, setSkuSearch] = useState("");
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuError, setSkuError] = useState<string | null>(null);
  const skuInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (orden && mode === "edit") {
      setFormData({
        id_orden: orden.id_orden,
        cliente: orden.cliente,
        fecha: orden.fecha,
      });
      setFolios(orden.folios);
      if (orden.folios.length > 0) {
        setSelectedFolioId(orden.folios[0].id);
      }
    } else {
      const today = new Date().toISOString().split("T")[0];
      setFormData({
        id_orden: "",
        cliente: "",
        fecha: today,
      });
      setFolios([]);
      setSelectedFolioId(null);
    }
    setError(null);
    setSkuSearch("");
    setSkuError(null);
    setNewFolioNumber("");
    setPdfFile(null);
    setPdfFileName(null);
  }, [orden, mode, visible]);

  const handleAddProductBySku = async () => {
    if (!selectedFolioId) {
      setSkuError("Debes seleccionar un folio primero");
      return;
    }

    const trimmedSku = skuSearch.trim();
    if (!trimmedSku) {
      setSkuError("Ingresa un SKU");
      return;
    }

    setSkuLoading(true);
    setSkuError(null);

    try {
      // Buscar producto por SKU usando endpoint Odoo
      const data = await fetchAPI("/api/odoo/productos?pageSize=1000");

      const rawItems = Array.isArray(data) ? data : data.items || [];

      // Filter client-side by SKU
      const matched = rawItems.filter(
        (item: any) =>
          (item.master_sku || "").toLowerCase().includes(trimmedSku.toLowerCase()) ||
          (item.nombre_producto || "").toLowerCase().includes(trimmedSku.toLowerCase())
      );

      if (!matched || matched.length === 0) {
        setSkuError(`No existe producto con SKU: ${trimmedSku}`);
        return;
      }

      const product = matched[0];

      const newProducto: Producto = {
        id: (product.id_articulo || product.id).toString(),
        nombre: product.nombre_producto || product.name,
        sku: product.master_sku || product.sku,
        cantidad: 1,
        precio: product.precio || product.price || 0,
      };

      setFolios(
        folios.map((f) =>
          f.id === selectedFolioId
            ? { ...f, productos: [...f.productos, newProducto] }
            : f
        )
      );

      setSkuSearch("");
      setSkuError(null);
    } catch (err) {
      setSkuError(err instanceof Error ? err.message : "Error al buscar SKU");
    } finally {
      setSkuLoading(false);
    }
  };

  const handleSkuKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleAddProductBySku();
    }
  };

  const handleFileSelect = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // VALIDATION: Only PDF files allowed
    if (file.type !== "application/pdf") {
      setError("Solo se permiten archivos PDF");
      return;
    }

    // VALIDATION: File size limit (10MB)
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      setError("El PDF debe ser menor a 10MB");
      return;
    }

    // CONVERSION: Read file as Base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      // Strip the data URI prefix and save only the Base64 content
      setPdfFile(base64.split(",")[1]);
      setPdfFileName(file.name);
      setError(null); // Clear any previous errors
    };
    reader.onerror = () => {
      setError("Error al leer el archivo PDF");
    };
    reader.readAsDataURL(file);

    // Reset the input to allow selecting the same file again
    event.target.value = "";
  };

  const handleRemovePdf = () => {
    setPdfFile(null);
    setPdfFileName(null);
  };

  const handleAddFolio = () => {
    if (!newFolioNumber.trim()) {
      alert("Ingresa el número de folio");
      return;
    }

    const newFolio: Folio = {
      id: Date.now().toString(),
      numero_folio: newFolioNumber,
      productos: [],
    };
    setFolios([...folios, newFolio]);
    setSelectedFolioId(newFolio.id);
    setNewFolioNumber("");
  };

  const handleRemoveFolio = (folioId: string) => {
    const updatedFolios = folios.filter((f) => f.id !== folioId);
    setFolios(updatedFolios);
    if (selectedFolioId === folioId) {
      setSelectedFolioId(updatedFolios.length > 0 ? updatedFolios[0].id : null);
    }
  };

  const handleAddProducto = () => {
    if (!selectedFolioId) return;

    const newProducto: Producto = {
      id: Date.now().toString(),
      nombre: "",
      sku: "",
      cantidad: 1,
      precio: 0,
    };

    setFolios(
      folios.map((f) =>
        f.id === selectedFolioId
          ? { ...f, productos: [...f.productos, newProducto] }
          : f
      )
    );
  };

  const handleRemoveProducto = (productoId: string) => {
    if (!selectedFolioId) return;

    setFolios(
      folios.map((f) =>
        f.id === selectedFolioId
          ? { ...f, productos: f.productos.filter((p) => p.id !== productoId) }
          : f
      )
    );
  };

  const handleUpdateProducto = (
    productoId: string,
    field: keyof Producto,
    value: any
  ) => {
    if (!selectedFolioId) return;

    setFolios(
      folios.map((f) =>
        f.id === selectedFolioId
          ? {
              ...f,
              productos: f.productos.map((p) =>
                p.id === productoId ? { ...p, [field]: value } : p
              ),
            }
          : f
      )
    );
  };

  const calculateTotals = () => {
    let totalProductos = 0;
    let totalPrecio = 0;

    folios.forEach((folio) => {
      folio.productos.forEach((producto) => {
        totalProductos += producto.cantidad;
        totalPrecio += producto.cantidad * producto.precio;
      });
    });

    return { totalProductos, totalPrecio };
  };

  const handleSave = async () => {
    if (!formData.id_orden.trim()) {
      setError("El número de orden es obligatorio");
      return;
    }

    if (!formData.cliente.trim()) {
      setError("El nombre del cliente es obligatorio");
      return;
    }

    if (!formData.fecha) {
      setError("La fecha es obligatoria");
      return;
    }

    if (folios.length === 0) {
      setError("Debe agregar al menos un folio");
      return;
    }

    for (const folio of folios) {
      if (folio.productos.length === 0) {
        setError(
          `El folio ${folio.numero_folio} debe tener al menos un producto`
        );
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const ordenData: OrdenVenta = {
        id_orden: formData.id_orden,
        cliente: formData.cliente,
        fecha: formData.fecha,
        folios: folios,
        pdf: pdfFile,
      };

      await onSave(ordenData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  const selectedFolio = folios.find((f) => f.id === selectedFolioId);
  const { totalProductos, totalPrecio } = calculateTotals();

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center p-4 z-50">
      <div className="bg-white rounded-xl w-full max-w-7xl max-h-[95vh] flex flex-col">
        <div className="flex flex-row items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-2xl font-robotoMedium text-gray-800">
            {mode === "create" ? "Nueva Orden de Venta" : "Editar Orden"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
          >
            <span className="text-gray-500 text-2xl">×</span>
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-3">
            <p className="text-red-600 font-robotoRegular">{error}</p>
          </div>
        )}

        <div className="flex-1 flex flex-row">
          <div className="w-80 border-r border-gray-200 p-6">
            <h3 className="text-lg font-robotoMedium text-gray-800 mb-4">
              Información de la Orden
            </h3>

            <div className="mb-4">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Número de Orden *
              </label>
              <input
                type="text"
                value={formData.id_orden}
                onChange={(e) =>
                  setFormData({ ...formData, id_orden: e.target.value })
                }
                placeholder="ORD-12345"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
              />
            </div>

            <div className="mb-4">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Cliente *
              </label>
              <input
                type="text"
                value={formData.cliente}
                onChange={(e) =>
                  setFormData({ ...formData, cliente: e.target.value })
                }
                placeholder="Nombre del cliente"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
              />
            </div>

            <div className="mb-6">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Fecha *
              </label>
              <input
                type="date"
                value={formData.fecha}
                onChange={(e) =>
                  setFormData({ ...formData, fecha: e.target.value })
                }
                className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
              />
            </div>

            <div className="flex-1">
              <div className="flex flex-row items-center justify-between gap-2 mb-3">
                <h4 className="text-sm font-robotoMedium text-gray-700">
                  Folios
                </h4>
                <div className="flex gap-2 flex-1 max-w-xs">
                  <input
                    type="number"
                    value={newFolioNumber}
                    onChange={(e) => setNewFolioNumber(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAddFolio()}
                    placeholder="Nº folio"
                    min="0"
                    className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm bg-white"
                  />
                  <button
                    onClick={handleAddFolio}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                  >
                    Agregar
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto max-h-48 space-y-2">
                {folios.map((folio) => (
                  <div key={folio.id} className="p-2 border border-gray-200 rounded">
                    <div className="flex flex-row justify-between items-center mb-2">
                      <span className="text-sm font-robotoMedium">
                        {folio.numero_folio}
                      </span>
                      <button
                        onClick={() => handleRemoveFolio(folio.id)}
                        className="text-red-600 text-xs hover:text-red-700"
                      >
                        Quitar
                      </button>
                    </div>
                    <button
                      onClick={() => setSelectedFolioId(folio.id)}
                      className={`w-full text-left px-2 py-1 rounded text-xs ${
                        selectedFolioId === folio.id
                          ? "bg-blue-100 text-blue-700"
                          : "bg-gray-100"
                      }`}
                    >
                      ({folio.productos.length} productos)
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mt-4">
              <div className="flex flex-row justify-between mb-2">
                <p className="text-sm text-gray-600">Total Productos:</p>
                <p className="text-sm font-robotoMedium">{totalProductos}</p>
              </div>
              <div className="flex flex-row justify-between">
                <p className="text-sm text-gray-600">Total Precio:</p>
                <p className="text-sm font-robotoMedium">${totalPrecio.toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col p-6">
            {selectedFolio ? (
              <>
                <div className="mb-4">
                  <div className="flex flex-row items-center justify-between mb-3">
                    <h4 className="text-lg font-robotoMedium">
                      {selectedFolio.numero_folio}
                    </h4>
                    <div className="flex gap-2">
                      <div className="relative flex-1 max-w-xs">
                        <div className="flex gap-2">
                          <input
                            ref={skuInputRef}
                            type="text"
                            value={skuSearch}
                            onChange={(e) => setSkuSearch(e.target.value)}
                            onKeyPress={handleSkuKeyPress}
                            placeholder="Ingresa SKU..."
                            className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm"
                          />
                          <button
                            onClick={handleAddProductBySku}
                            disabled={skuLoading || !skuSearch.trim()}
                            className="px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                          >
                            {skuLoading ? "Buscando..." : "Agregar"}
                          </button>
                        </div>
                        {skuError && (
                          <div className="absolute top-12 left-0 right-0 bg-red-50 border border-red-200 rounded text-xs text-red-600 p-2 z-50 max-w-xs">
                            {skuError}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedFolio.productos.length === 0 ? (
                    <p className="text-gray-500">No hay productos</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-100 border-b-2 border-gray-300">
                            <th className="px-4 py-3 text-left font-robotoMedium text-gray-900 border-r border-gray-300">
                              Nombre del Producto
                            </th>
                            <th className="px-4 py-3 text-left font-robotoMedium text-gray-900 border-r border-gray-300">
                              SKU
                            </th>
                            <th className="px-4 py-3 text-left font-robotoMedium text-gray-900 border-r border-gray-300">
                              Cantidad
                            </th>
                            <th className="px-4 py-3 text-left font-robotoMedium text-gray-900 border-r border-gray-300">
                              Precio
                            </th>
                            <th className="px-4 py-3 text-center font-robotoMedium text-gray-900">
                              Acción
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedFolio.productos.map((producto, index) => (
                            <tr
                              key={producto.id}
                              className={`border-b border-gray-200 ${
                                index % 2 === 0 ? "bg-white" : "bg-gray-50"
                              } hover:bg-gray-100 transition-colors`}
                            >
                              <td className="px-4 py-2 border-r border-gray-200">
                                <input
                                  type="text"
                                  value={producto.nombre}
                                  onChange={(e) =>
                                    handleUpdateProducto(producto.id, "nombre", e.target.value)
                                  }
                                  placeholder="Nombre del producto"
                                  readOnly
                                  className="w-full px-2 py-1 border border-gray-300 rounded bg-gray-50 text-sm cursor-not-allowed"
                                />
                              </td>
                              <td className="px-4 py-2 border-r border-gray-200">
                                <input
                                  type="text"
                                  value={producto.sku}
                                  onChange={(e) =>
                                    handleUpdateProducto(producto.id, "sku", e.target.value)
                                  }
                                  placeholder="SKU"
                                  className="w-full px-2 py-1 border border-gray-300 rounded bg-white text-sm"
                                />
                              </td>
                              <td className="px-4 py-2 border-r border-gray-200">
                                <input
                                  type="number"
                                  value={producto.cantidad}
                                  onChange={(e) =>
                                    handleUpdateProducto(
                                      producto.id,
                                      "cantidad",
                                      Math.max(0, parseInt(e.target.value) || 0)
                                    )
                                  }
                                  placeholder="1"
                                  min="0"
                                  className="w-full px-2 py-1 border border-gray-300 rounded bg-white text-sm"
                                />
                              </td>
                              <td className="px-4 py-2 border-r border-gray-200">
                                <input
                                  type="number"
                                  value={producto.precio}
                                  onChange={(e) =>
                                    handleUpdateProducto(
                                      producto.id,
                                      "precio",
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  placeholder="0.00"
                                  className="w-full px-2 py-1 border border-gray-300 rounded bg-white text-sm"
                                />
                              </td>
                              <td className="px-4 py-2 text-center">
                                <button
                                  onClick={() => handleRemoveProducto(producto.id)}
                                  className="text-red-500 text-xl hover:text-red-700 transition-colors"
                                  title="Eliminar producto"
                                >
                                  🗑️
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-gray-500">Selecciona un folio para agregar productos</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 px-6 py-4">
          <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
            Adjuntar PDF (Opcional)
          </label>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors">
              <span className="text-white font-robotoMedium text-sm">
                {pdfFileName ? "Cambiar PDF" : "Seleccionar PDF"}
              </span>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>

            {pdfFileName && (
              <div className="flex items-center gap-2 bg-green-50 px-3 py-2 rounded-lg border border-green-200 flex-1">
                <span className="text-green-700 font-robotoRegular text-sm">
                  📄 {pdfFileName}
                </span>
                <button
                  type="button"
                  onClick={handleRemovePdf}
                  className="ml-auto text-red-500 hover:text-red-700 font-bold text-lg"
                  title="Quitar PDF"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Solo archivos PDF, máximo 10MB
          </p>
        </div>

        <div className="flex flex-row items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-6 py-3 rounded-lg border border-gray-300 disabled:opacity-50"
          >
            <span className="text-gray-700 font-robotoMedium">Cancelar</span>
          </button>

          <button
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-3 rounded-lg bg-blue-600 disabled:opacity-50"
          >
            <span className="text-white font-robotoMedium">
              {loading ? "Guardando..." : mode === "create" ? "Crear" : "Guardar"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}