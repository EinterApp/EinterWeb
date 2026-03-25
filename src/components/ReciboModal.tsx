import { useState, useEffect, useRef } from "react";
import { fetchAPI } from "../lib/fetch";

export interface Producto {
  id: string;
  nombre: string;
  sku: string;
  cantidad: number;
  costo_por_articulo: number;
}

export interface ReciboData {
  orden: string;
  proveedor_id: number;
  proveedor_name?: string;
  tipo: number;
  fecha_compra: string;
  eta: string;
  productos: Producto[];
  pdf?: string | File | null;
}

interface Proveedor {
  id: number;
  name: string;
  city: string;
  lead_time: number;
}

interface ReciboModalProps {
  visible: boolean;
  recibo: ReciboData | null;
  onClose: () => void;
  onSave: (recibo: ReciboData) => Promise<void>;
  mode: "create" | "edit";
}

export function ReciboModal({
  visible,
  recibo,
  onClose,
  onSave,
  mode,
}: ReciboModalProps) {
  const [formData, setFormData] = useState({
    orden: "",
    proveedor_id: "",
    tipo: "1",
    fecha_compra: "",
    eta: "",
  });
  const [productos, setProductos] = useState<Producto[]>([]);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [showProveedorList, setShowProveedorList] = useState(false);
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProveedores, setLoadingProveedores] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<string | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [skuSearch, setSkuSearch] = useState("");
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuError, setSkuError] = useState<string | null>(null);
  const [proveedorSearch, setProveedorSearch] = useState("");
  const [filteredProveedores, setFilteredProveedores] = useState<Proveedor[]>([]);
  const skuInputRef = useRef<HTMLInputElement>(null);
  const proveedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) {
      fetchProveedores();
    }
  }, [visible]);

  useEffect(() => {
    // Filtrar proveedores cuando cambia el search
    const filtered = proveedores.filter((p) =>
      p.name.toLowerCase().includes(proveedorSearch.toLowerCase())
    );
    setFilteredProveedores(filtered);
  }, [proveedorSearch, proveedores]);

  useEffect(() => {
    // Cerrar dropdown cuando hace click fuera
    const handleClickOutside = (event: MouseEvent) => {
      if (proveedorRef.current && !proveedorRef.current.contains(event.target as Node)) {
        setShowProveedorList(false);
      }
    };

    if (showProveedorList) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [showProveedorList]);

  useEffect(() => {
    if (recibo && mode === "edit") {
      setFormData({
        orden: recibo.orden,
        proveedor_id: String(recibo.proveedor_id),
        tipo: String(recibo.tipo),
        fecha_compra: recibo.fecha_compra,
        eta: recibo.eta,
      });
      setProductos(recibo.productos);
      const proveedor = proveedores.find((p) => p.id === recibo.proveedor_id);
      setSelectedProveedor(proveedor || null);
    } else {
      const today = new Date().toISOString().split("T")[0];
      setFormData({
        orden: "",
        proveedor_id: "",
        tipo: "1",
        fecha_compra: today,
        eta: "",
      });
      setProductos([]);
      setSelectedProveedor(null);
    }
    setError(null);
    setPdfFile(null);
    setPdfFileName(null);
    setSkuSearch("");
    setSkuError(null);
    setProveedorSearch("");
    setFilteredProveedores(proveedores);
  }, [recibo, mode, visible, proveedores]);

  const fetchProveedores = async () => {
    setLoadingProveedores(true);
    try {
      const data = await fetchAPI("/api/odoo/proveedores");
      const rawList = Array.isArray(data) ? data : data.items || [];
      // Map Odoo raw fields to Proveedor type
      const proveedoresList: Proveedor[] = rawList.map((item: any) => ({
        id: item.id_proveedor || item.id,
        name: item.nombre || item.name,
        city: item.ciudad || item.city || "",
        lead_time: 0,
      }));
      setProveedores(proveedoresList);
      setFilteredProveedores(proveedoresList);
    } catch (err) {
      console.error("Error fetching proveedores:", err);
      setProveedores([]);
      setFilteredProveedores([]);
    } finally {
      setLoadingProveedores(false);
    }
  };

  const handleAddProductBySku = async () => {
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
        costo_por_articulo: product.precio || product.price || 0,
      };

      setProductos([...productos, newProducto]);

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

  const handleRemoveProducto = (productoId: string) => {
    setProductos(productos.filter((p) => p.id !== productoId));
  };

  const handleUpdateProducto = (
    productoId: string,
    field: keyof Producto,
    value: any
  ) => {
    setProductos(
      productos.map((p) => (p.id === productoId ? { ...p, [field]: value } : p))
    );
  };

  const calculateTotal = () => {
    return productos.reduce(
      (total, p) => total + p.cantidad * p.costo_por_articulo,
      0
    );
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

  const handleSave = async () => {
    setError(null);
    
    if (!formData.orden.trim()) {
      setError("El número de orden es obligatorio");
      return;
    }

    if (!formData.proveedor_id) {
      setError("Debe seleccionar un proveedor");
      return;
    }

    if (!formData.fecha_compra) {
      setError("La fecha de compra es obligatoria");
      return;
    }

    if (productos.length === 0) {
      setError("Debe agregar al menos un producto");
      return;
    }

    for (const producto of productos) {
      if (!producto.nombre.trim() || !String(producto.sku).trim()) {
        setError("Todos los productos deben tener nombre y SKU");
        return;
      }
      if (producto.cantidad <= 0 || producto.costo_por_articulo <= 0) {
        setError("La cantidad y el costo deben ser mayores a 0");
        return;
      }
    }

    setLoading(true);

    try {
      const reciboData: ReciboData = {
        orden: formData.orden,
        proveedor_id: parseInt(formData.proveedor_id),
        proveedor_name: selectedProveedor?.name,
        tipo: parseInt(formData.tipo),
        fecha_compra: formData.fecha_compra,
        eta: formData.eta || formData.fecha_compra,
        productos: productos,
        pdf: pdfFile,
      };

      await onSave(reciboData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      console.error("Error saving recibo:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center p-4 z-50">
      <div className="bg-white rounded-xl w-full max-w-5xl max-h-[95vh] flex flex-col">
        <div className="flex flex-row items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-2xl font-robotoMedium text-gray-800">
            {mode === "create" ? "Agregar Compra" : "Editar Compra"}
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

        {!error && !productos.length && (
          <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3">
            <p className="text-yellow-700 font-robotoRegular text-sm">ℹ️ Debes agregar al menos un producto para crear la compra</p>
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <div className="space-y-4">
            <div className="flex flex-row gap-4">
              <div className="flex-1">
                <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                  Número de Orden
                </label>
                <input
                  type="text"
                  value={formData.orden}
                  onChange={(e) =>
                    setFormData({ ...formData, orden: e.target.value })
                  }
                  placeholder="50000"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Proveedor *
              </label>
              <div className="relative" ref={proveedorRef}>
                <input
                  type="text"
                  value={proveedorSearch}
                  onChange={(e) => {
                    setProveedorSearch(e.target.value);
                    setShowProveedorList(true);
                  }}
                  onFocus={() => setShowProveedorList(true)}
                  placeholder="Busca o selecciona un proveedor"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {showProveedorList && (
                  <div className="absolute top-full left-0 right-0 mt-1 border border-gray-200 rounded-lg bg-white overflow-y-auto max-h-48 z-50 shadow-lg">
                    {loadingProveedores ? (
                      <div className="p-3 text-gray-600">Cargando...</div>
                    ) : filteredProveedores.length === 0 ? (
                      <div className="p-3 text-gray-500">
                        No hay proveedores que coincidan
                      </div>
                    ) : (
                      filteredProveedores.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedProveedor(p);
                            setFormData(prev => ({ ...prev, proveedor_id: String(p.id) }));
                            setProveedorSearch(p.name);
                            setShowProveedorList(false);
                          }}
                          className="w-full text-left px-4 py-2 border-b border-gray-100 hover:bg-blue-50 transition-colors"
                        >
                          <div className="font-robotoMedium text-gray-900">{p.name}</div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-row gap-4">
              <div className="flex-1">
                <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                  Fecha de Compra
                </label>
                <input
                  type="date"
                  value={formData.fecha_compra}
                  onChange={(e) =>
                    setFormData({ ...formData, fecha_compra: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                  ETA
                </label>
                <input
                  type="date"
                  value={formData.eta}
                  onChange={(e) =>
                    setFormData({ ...formData, eta: e.target.value })
                  }
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white"
                />
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4 mt-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-robotoMedium">Productos</h3>
              </div>

              <div className="mb-4 p-3 border border-gray-200 rounded-lg bg-gray-50">
                <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                  Agregar producto por SKU
                </label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      ref={skuInputRef}
                      type="text"
                      value={skuSearch}
                      onChange={(e) => setSkuSearch(e.target.value)}
                      onKeyPress={handleSkuKeyPress}
                      placeholder="Ingresa SKU..."
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
                    />
                    {skuError && (
                      <p className="text-red-600 text-xs mt-1">{skuError}</p>
                    )}
                  </div>
                  <button
                    onClick={handleAddProductBySku}
                    disabled={skuLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-robotoMedium"
                  >
                    {skuLoading ? "Buscando..." : "Agregar"}
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center mb-4">
                <h4 className="text-base font-robotoMedium">Productos agregados</h4>
              </div>

              {productos.length === 0 ? (
                <p className="text-gray-500">No hay productos agregados</p>
              ) : (
                <div className="space-y-3">
                  {productos.map((producto) => (
                    <div key={producto.id} className="p-3 border border-gray-200 rounded-lg">
                      <div className="grid grid-cols-5 gap-3 mb-2">
                        <input
                          type="text"
                          value={producto.nombre}
                          onChange={(e) =>
                            handleUpdateProducto(producto.id, "nombre", e.target.value)
                          }
                          placeholder="Nombre"
                          className="px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="text"
                          value={producto.sku}
                          onChange={(e) =>
                            handleUpdateProducto(producto.id, "sku", e.target.value)
                          }
                          placeholder="SKU"
                          className="px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="number"
                          value={producto.cantidad}
                          onChange={(e) =>
                            handleUpdateProducto(producto.id, "cantidad", parseInt(e.target.value) || 0)
                          }
                          placeholder="Cantidad"
                          className="px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="number"
                          value={producto.costo_por_articulo}
                          onChange={(e) =>
                            handleUpdateProducto(
                              producto.id,
                              "costo_por_articulo",
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="Costo"
                          className="px-3 py-2 border border-gray-300 rounded text-sm"
                        />
                        <button
                          onClick={() => handleRemoveProducto(producto.id)}
                          className="px-3 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-right font-robotoMedium">
                  Total: ${calculateTotal().toFixed(2)}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-4">
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
          </div>
        </div>

        <div className="flex flex-row items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-6 py-3 rounded-lg border border-gray-300 disabled:opacity-50 cursor-pointer pointer-events-auto"
          >
            <span className="text-gray-700 font-robotoMedium">Cancelar</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-3 rounded-lg bg-blue-600 disabled:opacity-50 cursor-pointer pointer-events-auto hover:bg-blue-700 active:bg-blue-800"
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