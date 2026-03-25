import { useState, useEffect } from "react";
import { fetchAPI } from "../lib/fetch";
import type { Product } from "../lib/types";

interface ProductModalProps {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
  onSave: (product: Partial<Product>) => Promise<void>;
  mode: "create" | "edit";
}

interface FormData {
  sku: string;
  name: string;
  category_id: string;
  supplier_id: string;
  description: string;
  price: string;
  cost: string;
  stock: string;
  weight_kg: string;
  standard_tarima: string;
  alto: string;
  ancho: string;
  largo: string;
  photoUri?: string;
  photoBase64?: string;
}

const initialFormData: FormData = {
  sku: "",
  name: "",
  category_id: "",
  supplier_id: "",
  description: "",
  price: "",
  cost: "",
  stock: "",
  weight_kg: "",
  standard_tarima: "",
  alto: "",
  ancho: "",
  largo: "",
  photoUri: undefined,
  photoBase64: undefined,
};

export function ProductModal({
  visible,
  product,
  onClose,
  onSave,
  mode,
}: ProductModalProps) {
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [showSupplierList, setShowSupplierList] = useState(false);
  const [categories, setCategories] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [showCategoryList, setShowCategoryList] = useState(false);

  useEffect(() => {
    if (product && mode === "edit") {
      // Handle category - could be string, number, or object with id
      let categoryId = "";
      if (product.category) {
        if (typeof product.category === "object" && "id" in product.category) {
          categoryId = String(product.category.id);
        } else {
          categoryId = String(product.category);
        }
      }

      setFormData({
        sku: String(product.sku || ""),
        name: product.name || "",
        category_id: categoryId,
        supplier_id: String(product.supplier?.id || ""),
        description: product.description || "",
        price: String(product.price || ""),
        cost: String(product.cost || ""),
        stock: String(product.stock || ""),
        weight_kg: String(product.weight_kg || ""),
        standard_tarima: String(product.standard_tarima || ""),
        largo: String(product.dimensions_cm?.largo || ""),
        ancho: String(product.dimensions_cm?.ancho || ""),
        alto: String(product.dimensions_cm?.alto || ""),
        photoUri: product.photo || undefined,
      });
    } else {
      setFormData(initialFormData);
    }
    setError(null);
  }, [product, mode, visible]);

  const fetchSuppliers = async () => {
    setLoadingSuppliers(true);
    try {
      const data = await fetchAPI("/api/odoo/proveedores");
      const suppliersList = data.items || data || [];
      setSuppliers(
        suppliersList.map((supplier: any) => ({
          id: supplier.id_proveedor || supplier.id,
          name: supplier.nombre || supplier.name,
        }))
      );
    } catch (err) {
      console.error("Failed to load suppliers", err);
      setSuppliers([]);
    } finally {
      setLoadingSuppliers(false);
    }
  };

  const fetchCategories = async () => {
    setLoadingCategories(true);
    try {
      const data = await fetchAPI("/api/categorias");
      const categoriesList = data.items || data || [];
      setCategories(
        categoriesList.map((category: any) => ({
          id: category.id,
          name: category.name,
        }))
      );
    } catch (err) {
      console.error("Failed to load categories", err);
      setCategories([]);
    } finally {
      setLoadingCategories(false);
    }
  };

  useEffect(() => {
    if (visible) {
      fetchSuppliers();
      fetchCategories();
    }
  }, [visible]);

  const compressImage = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Resize if image is too large (max 800px width)
          if (width > 800) {
            height = Math.round((height * 800) / width);
            width = 800;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // Compress to JPEG with quality 0.5 for smaller payload
          const compressed = canvas.toDataURL("image/jpeg", 0.5);
          const base64Data = compressed.split(",")[1];
          resolve(base64Data);
        };
        img.onerror = () => reject(new Error("Could not load image"));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  };

  const pickImage = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const compressedBase64 = await compressImage(file);
        setFormData({
          ...formData,
          photoUri: file.name,
          photoBase64: compressedBase64,
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error compressing image"
        );
      }
    };
    input.click();
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      setError("El nombre es obligatorio");
      return;
    }

    if (!formData.sku.trim()) {
      setError("El SKU es obligatorio");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const productData: Partial<Product> = {
        sku: formData.sku,
        name: formData.name,
        category: formData.category_id,
        price: parseFloat(formData.price) || 0,
        cost: parseFloat(formData.cost) || 0,
        stock: parseFloat(formData.stock) || 0,
        weight_kg: parseFloat(formData.weight_kg) || 0,
        dimensions_cm: {
          largo: parseFloat(formData.largo) || 0,
          ancho: parseFloat(formData.ancho) || 0,
          alto: parseFloat(formData.alto) || 0,
        },
        photo: formData.photoBase64
          ? `data:image/jpeg;base64,${formData.photoBase64}`
          : formData.photoUri,
        supplier: formData.supplier_id
          ? {
              id: parseInt(formData.supplier_id),
              name:
                suppliers.find((s) => s.id === parseInt(formData.supplier_id))
                  ?.name || "",
            }
          : null,
        description: formData.description,
        standard_tarima: parseFloat(formData.standard_tarima) || undefined,
      };

      if (mode === "edit" && product) {
        productData.id = product.id;
      }

      await onSave(productData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setLoading(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center p-4 z-50">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex flex-row items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-robotoMedium text-gray-800">
            {mode === "create" ? "Crear Producto" : "Editar Producto"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full"
          >
            <span className="text-gray-500 text-xl">✕</span>
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-4 flex-1">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          <div className="mb-4">
            <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
              SKU
            </label>
            <input
              type="text"
              value={formData.sku}
              onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
              placeholder="SKU del producto"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
            />
          </div>

          <div className="mb-4">
            <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
              Nombre
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Nombre del producto"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
            />
          </div>

          <div className="flex flex-row gap-4 mb-4">
            <div className="flex-1">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Categoría
              </label>
              <button
                onClick={() => setShowCategoryList((s) => !s)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-left"
              >
                {(() => {
                  const id = parseInt(formData.category_id || "", 10);
                  const found = categories.find((c) => c.id === id);
                  if (found) return found.name;
                  if (loadingCategories) return "Cargando...";
                  return "Selecciona Categoría";
                })()}
              </button>

              {showCategoryList && (
                <div className="mt-2 max-h-40 border border-gray-200 rounded-lg bg-white overflow-y-auto">
                  {loadingCategories ? (
                    <div className="p-3 text-center">Cargando...</div>
                  ) : categories.length === 0 ? (
                    <div className="p-3">
                      <p className="text-sm text-gray-500">
                        No hay categorías
                      </p>
                      <button
                        onClick={fetchCategories}
                        className="mt-2 px-3 py-2 bg-gray-100 rounded text-sm"
                      >
                        Recargar
                      </button>
                    </div>
                  ) : (
                    <div>
                      {categories.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setFormData({
                              ...formData,
                              category_id: String(c.id),
                            });
                            setShowCategoryList(false);
                          }}
                          className="w-full text-left px-4 py-2 border-b border-gray-100 hover:bg-gray-50"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Proveedor
              </label>
              <button
                onClick={() => setShowSupplierList((s) => !s)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white text-left"
              >
                {(() => {
                  const id = parseInt(formData.supplier_id || "", 10);
                  const found = suppliers.find((s) => s.id === id);
                  if (found) return found.name;
                  if (loadingSuppliers) return "Cargando...";
                  return "Selecciona Proveedor";
                })()}
              </button>

              {showSupplierList && (
                <div className="mt-2 max-h-40 border border-gray-200 rounded-lg bg-white overflow-y-auto">
                  {loadingSuppliers ? (
                    <div className="p-3 text-center">Cargando...</div>
                  ) : suppliers.length === 0 ? (
                    <div className="p-3">
                      <p className="text-sm text-gray-500">
                        No hay proveedores
                      </p>
                      <button
                        onClick={fetchSuppliers}
                        className="mt-2 px-3 py-2 bg-gray-100 rounded text-sm"
                      >
                        Recargar
                      </button>
                    </div>
                  ) : (
                    <div>
                      {suppliers.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setFormData({
                              ...formData,
                              supplier_id: String(s.id),
                            });
                            setShowSupplierList(false);
                          }}
                          className="w-full text-left px-4 py-2 border-b border-gray-100 hover:bg-gray-50"
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-row gap-4 mb-4">
            <div className="flex-1">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Precio
              </label>
              <input
                type="number"
                value={formData.price}
                onChange={(e) =>
                  setFormData({ ...formData, price: e.target.value })
                }
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
            <div className="flex-1">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Costo
              </label>
              <input
                type="number"
                value={formData.cost}
                onChange={(e) =>
                  setFormData({ ...formData, cost: e.target.value })
                }
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
          </div>

          <div className="flex flex-row gap-4 mb-4">
            <div className="flex-1">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Stock
              </label>
              <input
                type="number"
                value={formData.stock}
                onChange={(e) =>
                  setFormData({ ...formData, stock: e.target.value })
                }
                placeholder="0"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
            <div className="flex-1">
              <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
                Peso del carton (kg)
              </label>
              <input
                type="number"
                value={formData.weight_kg}
                onChange={(e) =>
                  setFormData({ ...formData, weight_kg: e.target.value })
                }
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
          </div>

          <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
            Dimensiones del carton (cm)
          </label>
          <div className="flex flex-row gap-4 mb-6">
            <div className="flex-1">
              <label className="text-xs text-gray-600 mb-1 block">Altura</label>
              <input
                type="number"
                value={formData.alto}
                onChange={(e) =>
                  setFormData({ ...formData, alto: e.target.value })
                }
                placeholder="Altura"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-600 mb-1 block">Anchura</label>
              <input
                type="number"
                value={formData.ancho}
                onChange={(e) =>
                  setFormData({ ...formData, ancho: e.target.value })
                }
                placeholder="Anchura"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-600 mb-1 block">Largo</label>
              <input
                type="number"
                value={formData.largo}
                onChange={(e) =>
                  setFormData({ ...formData, largo: e.target.value })
                }
                placeholder="Largo"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
              Estándar X Tarima
            </label>
            <input
              type="number"
              value={formData.standard_tarima}
              onChange={(e) =>
                setFormData({ ...formData, standard_tarima: e.target.value })
              }
              placeholder="Cantidad por tarima"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white"
            />
          </div>

          <div className="mb-6">
            <label className="text-sm font-robotoMedium text-gray-700 mb-2 block">
              Subir Foto
            </label>
            <button
              onClick={pickImage}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-center hover:bg-gray-50"
            >
              <span className="text-gray-600">
                {formData.photoUri ? "Cambiar imagen" : "Seleccionar imagen"}
              </span>
            </button>

            {(formData.photoUri || formData.photoBase64) && (
              <div className="mt-2">
                <p className="text-sm text-gray-600 mb-2">Preview</p>
                <div className="flex flex-row items-center gap-3">
                  {formData.photoBase64 && (
                    <img
                      src={`data:image/jpeg;base64,${formData.photoBase64}`}
                      alt="preview"
                      className="w-32 h-32 rounded-lg object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 truncate">
                      {formData.photoUri || "Imagen en base64"}
                    </p>
                    <button
                      onClick={() =>
                        setFormData({
                          ...formData,
                          photoUri: undefined,
                          photoBase64: undefined,
                        })
                      }
                      className="mt-3 px-3 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200"
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-row items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-gray-300 disabled:opacity-50"
          >
            <span className="text-gray-700 font-robotoMedium">Cancelar</span>
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-2 rounded-lg bg-blue-600 disabled:opacity-50"
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