import { useState, useEffect, useCallback } from "react";
import { ProductModal } from "../components/ProductModal";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { useDarkMode } from "../context/DarkModeContext";
import { fetchAPI } from "../lib/fetch";
import type { Product, ApiResponse } from "../lib/types";

export function Productos() {
  useDarkMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  const [filterName, setFilterName] = useState("");
  const [filterSKU, setFilterSKU] = useState("");
  const [filterProveedor, setFilterProveedor] = useState("");
  const [filterCategoria, setFilterCategoria] = useState("");
  const [filterStock, setFilterStock] = useState("");
  const [sortBy, setSortBy] = useState<{
    column: string;
    direction: "asc" | "desc";
  } | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [imageZoomVisible, setImageZoomVisible] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  
  const fetchProducts = useCallback(async (searchQuery = "", pageNum = 1) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        page: pageNum.toString(),
        pageSize: "20",
      });

      const response = await fetchAPI(
        `/api/odoo/productos?${params}`
      );

      // Map Odoo raw DB fields to Product type
      const mapped: Product[] = (response.items || []).map((item: any) => ({
        id: item.id_articulo,
        sku: item.master_sku,
        name: item.nombre_producto,
        price: item.precio,
        cost: item.costo,
        photo: null,
        stock: item.existencias || 0,
        weight_kg: item.peso_kg || 0,
        dimensions_cm: {
          largo: item.largo_cm || 0,
          ancho: item.ancho_cm || 0,
          alto: item.alto_cm || 0,
        },
        supplier: item.id_proveedor
          ? { id: item.id_proveedor, name: item.proveedor_nombre }
          : null,
        category: item.id_categoria
          ? { id: item.id_categoria, name: item.nombre_categoria }
          : undefined,
        standard_tarima: item.inventario_standar_tarima || undefined,
      }));

      // Client-side search filter (Odoo endpoint doesn't support search param)
      const filtered = searchQuery.trim()
        ? mapped.filter(
            (p) =>
              p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
              String(p.sku).toLowerCase().includes(searchQuery.toLowerCase())
          )
        : mapped;

      setProducts(filtered);
      setFilteredProducts(filtered);
      setTotalPages(Math.ceil((response.total || 0) / (response.pageSize || 20)));
      setPage(pageNum);
    } catch (err) {
      console.error("Error fetching products from database:", err);
      setError(
        err instanceof Error ? err.message : "Error connecting to database"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const applyFilters = useCallback(() => {
    let filtered = [...products];

    // Filter by name
    if (filterName.trim()) {
      filtered = filtered.filter((product) =>
        product.name.toLowerCase().includes(filterName.toLowerCase())
      );
    }

    // Filter by SKU
    if (filterSKU.trim()) {
      filtered = filtered.filter((product) =>
        String(product.sku).toLowerCase().includes(filterSKU.toLowerCase())
      );
    }

    // Filter by proveedor
    if (filterProveedor.trim()) {
      filtered = filtered.filter((product) =>
        product.supplier?.name
          ?.toLowerCase()
          .includes(filterProveedor.toLowerCase())
      );
    }

    // Filter by categoría
    if (filterCategoria.trim()) {
      filtered = filtered.filter((product) =>
        (typeof product.category === "object"
          ? product.category?.name
          : product.category
        )
          ?.toLowerCase()
          .includes(filterCategoria.toLowerCase())
      );
    }

    // Filter by stock
    if (filterStock.trim()) {
      const stockValue = parseInt(filterStock);
      if (!isNaN(stockValue)) {
        filtered = filtered.filter((product) => product.stock === stockValue);
      }
    }

    // Sort
    if (sortBy) {
      filtered.sort((a, b) => {
        let aValue: any;
        let bValue: any;

        switch (sortBy.column) {
          case "name":
            aValue = (a.name || "").toLowerCase();
            bValue = (b.name || "").toLowerCase();
            break;
          case "sku":
            aValue = String(a.sku || "").toLowerCase();
            bValue = String(b.sku || "").toLowerCase();
            break;
          case "proveedor":
            aValue = (a.supplier?.name || "").toLowerCase();
            bValue = (b.supplier?.name || "").toLowerCase();
            break;
          case "weight":
            aValue = Number(a.weight_kg) || 0;
            bValue = Number(b.weight_kg) || 0;
            break;
          case "stock":
            aValue = Number(a.stock) || 0;
            bValue = Number(b.stock) || 0;
            break;
          case "price":
            aValue = Number(a.price) || 0;
            bValue = Number(b.price) || 0;
            break;
          case "cost":
            aValue = Number(a.cost) || 0;
            bValue = Number(b.cost) || 0;
            break;
          case "standard_tarima":
            aValue = Number(a.standard_tarima) || 0;
            bValue = Number(b.standard_tarima) || 0;
            break;
          default:
            return 0;
        }

        if (aValue < bValue) return sortBy.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortBy.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    setFilteredProducts(filtered);
  }, [products, filterName, filterSKU, filterProveedor, filterStock, sortBy]);

  // Apply filters whenever filter states change
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
    setFilterSKU("");
    setFilterProveedor("");
    setFilterCategoria("");
    setFilterStock("");
    setSortBy(null);
  };

  const handleSearch = (text: string) => {
    setSearchText(text);
    // Debounce the API call
    setTimeout(() => {
      fetchProducts(text, 1);
    }, 500);
  };

  // Create product
  const handleCreateProduct = async (productData: Partial<Product>) => {
    try {
      // Transform Product to ArticuloCreate format
      const apiData = {
        master_sku: productData.sku || "",
        nombre_producto: productData.name || "",
        foto: productData.photo || null,
        largo_cm: productData.dimensions_cm?.largo || 0,
        ancho_cm: productData.dimensions_cm?.ancho || 0,
        alto_cm: productData.dimensions_cm?.alto || 0,
        peso_kg: productData.weight_kg || 0,
        existencias: productData.stock || 0,
        precio: productData.price || 0,
        costo: productData.cost || 0,
        id_proveedor: productData.supplier?.id || null,
        id_categoria: productData.category ? parseInt(String(productData.category)) : null,
        inventario_standar_tarima: productData.standard_tarima || null,
      };

      const result = await fetchAPI("/(api)/productos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
      });

      // Sync to Odoo after creation
      if (result?.id) {
        try {
          await fetchAPI(`/api/odoo/sync/producto/${result.id}`, { method: "POST" });
        } catch (odooErr) {
          console.warn("Odoo sync failed (product will sync later):", odooErr);
        }
      }

      // Optimización: solo refrescar si estamos en la primera página sin búsqueda
      if (page === 1 && !searchText) {
        await fetchProducts("", 1);
      } else {
        setSearchText("");
        await fetchProducts("", 1);
      }
    } catch (err) {
      throw err;
    }
  };

  // Update product
  const handleUpdateProduct = async (productData: Partial<Product>) => {
    try {
      if (!productData.id) {
        throw new Error("ID del producto es requerido para actualizar");
      }

      // Transform Product to ArticuloUpdate format (only changed fields)
      const apiData: any = {};

      if (productData.sku !== undefined) apiData.master_sku = productData.sku;
      if (productData.name !== undefined)
        apiData.nombre_producto = productData.name;
      if (productData.photo !== undefined) apiData.foto = productData.photo;
      if (productData.dimensions_cm?.largo !== undefined)
        apiData.largo_cm = productData.dimensions_cm.largo;
      if (productData.dimensions_cm?.ancho !== undefined)
        apiData.ancho_cm = productData.dimensions_cm.ancho;
      if (productData.dimensions_cm?.alto !== undefined)
        apiData.alto_cm = productData.dimensions_cm.alto;
      if (productData.weight_kg !== undefined)
        apiData.peso_kg = productData.weight_kg;
      if (productData.stock !== undefined)
        apiData.existencias = productData.stock;
      if (productData.price !== undefined) apiData.precio = productData.price;
      if (productData.cost !== undefined) apiData.costo = productData.cost;
      if (productData.supplier?.id !== undefined)
        apiData.id_proveedor = productData.supplier.id;
      if (productData.standard_tarima !== undefined)
        apiData.inventario_standar_tarima = productData.standard_tarima;
      if (productData.category !== undefined)
        apiData.id_categoria = productData.category ? parseInt(String(productData.category)) : null;

      await fetchAPI(`/(api)/productos?id=${productData.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiData),
      });

      // Sync to Odoo after update
      try {
        await fetchAPI(`/api/odoo/sync/producto/${productData.id}`, { method: "POST" });
      } catch (odooErr) {
        console.warn("Odoo sync failed (product will sync later):", odooErr);
      }

      // Optimización: mantener la página actual
      await fetchProducts(searchText, page);
    } catch (err) {
      throw err;
    }
  };

  // Delete product
  const handleDeleteProduct = async () => {
    if (!productToDelete) return;

    setDeleteLoading(true);
    try {
      await fetchAPI(`/(api)/productos?id=${productToDelete.id}`, {
        method: "DELETE",
      });

      setDeleteModalVisible(false);
      setProductToDelete(null);

      // Optimización: mantener la página actual si no es la última y tiene productos
      await fetchProducts(searchText, page);
    } catch (err) {
      console.error("Error deleting product:", err);
      setError(err instanceof Error ? err.message : "Error deleting product");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Open modal for creating
  const openCreateModal = () => {
    setSelectedProduct(null);
    setModalMode("create");
    setModalVisible(true);
  };

  // Open modal for editing
  const openEditModal = (product: Product) => {
    setSelectedProduct(product);
    setModalMode("edit");
    setModalVisible(true);
  };

  // Open delete confirmation
  const openDeleteModal = (product: Product) => {
    setProductToDelete(product);
    setDeleteModalVisible(true);
  };

  return (
    <div className="w-full bg-gray-50 dark:bg-gray-900 flex flex-col min-h-screen">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex flex-row items-center justify-between">
          <h1 className="text-3xl font-bold tracking-wide text-gray-900 dark:text-white">
            Productos
          </h1>
          <button
            onClick={openCreateModal}
            className="px-6 py-2 border border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors text-sm font-medium text-gray-900 dark:text-white"
          >
            + Agregar Producto
          </button>
        </div>

        {/* Search Bar */}
        <div className="mt-4">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar por SKU o nombre..."
              value={searchText}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-base bg-white dark:bg-gray-700 dark:text-white pr-10 placeholder-gray-500 dark:placeholder-gray-400"
            />
            {searchText ? (
              <button
                onClick={() => {
                  setSearchText("");
                  fetchProducts("", 1);
                }}
                className="absolute right-3 top-3 text-gray-400 dark:text-gray-500 text-xl hover:text-gray-600 dark:hover:text-gray-400"
              >
                ✕
              </button>
            ) : (
              <div className="absolute right-3 top-3 text-gray-400 dark:text-gray-500 text-xl pointer-events-none">
                🔍
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-row items-center mt-4 gap-3">
          {(filterName ||
            filterSKU ||
            filterProveedor ||
            filterCategoria ||
            filterStock ||
            sortBy) && (
            <button
              onClick={clearFilters}
              className="bg-gray-200 dark:bg-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-robotoMedium"
            >
              Limpiar Filtros
            </button>
          )}
          {searchText && (
            <div className="bg-blue-100 dark:bg-blue-900 px-3 py-2 rounded-lg">
              <p className="text-blue-700 dark:text-blue-300 text-sm font-robotoMedium">
                Buscando: "{searchText}"
              </p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg">
            <p className="text-red-700 dark:text-red-300">Error: {error}</p>
            <button
              onClick={() => fetchProducts(searchText, 1)}
              className="mt-2 text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-300"
            >
              Reintentar
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white dark:bg-gray-800 mx-8 mt-4 border border-gray-400 dark:border-gray-700 overflow-hidden flex flex-col rounded-lg">
        {/* Excel-style header row with grid lines */}
        <div className="flex flex-row bg-gray-100 dark:bg-gray-700 border-b-2 border-gray-400 dark:border-gray-600">
          <div className="w-28 py-4 px-3 border-r border-gray-400 dark:border-gray-600 flex justify-center items-center">
            <h3 className="font-robotoMedium text-gray-900 dark:text-white text-lg text-center">
              Foto
            </h3>
          </div>
          <div className="flex-3 py-4 px-3 border-r border-gray-400 dark:border-gray-600 flex justify-center items-center">
            <button
              onClick={() => handleSort("name")}
              className="flex flex-row items-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 dark:text-white text-lg text-center">
                Nombre
              </h3>
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {sortBy?.column === "name"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.5] py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("sku")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                SKU
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "sku"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-2 py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("proveedor")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Proveedor
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "proveedor"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-2 py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("categoria")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Categoría
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "categoria"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.2] py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("weight")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Peso (kg)
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "weight"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.2] py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("stock")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Stock
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "stock"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.2] py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("price")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Precio
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "price"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.2] py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("cost")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Costo
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "cost"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.3] py-4 px-3 border-r border-gray-400 flex justify-center">
            <button
              onClick={() => handleSort("standard_tarima")}
              className="flex flex-row items-center justify-center gap-1 hover:opacity-75"
            >
              <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
                Estándar X Tarima
              </h3>
              <span className="text-xs text-gray-600">
                {sortBy?.column === "standard_tarima"
                  ? sortBy.direction === "asc"
                    ? "▲"
                    : "▼"
                  : "⬍"}
              </span>
            </button>
          </div>
          <div className="flex-[1.5] py-4 px-3 flex justify-center items-center">
            <h3 className="font-robotoMedium text-gray-900 text-lg text-center">
              Acciones
            </h3>
          </div>
        </div>

        {/* Excel-style data rows with grid lines */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {loading && products.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-500 font-robotoRegular mt-4">
                Cargando Productos...
              </p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <p className="text-gray-500 font-robotoRegular">
                No se encontraron Productos
              </p>
            </div>
          ) : (
            filteredProducts.map((product, index) => (
              <div
                key={product.id}
                className={`flex flex-row border-b border-gray-300 ${
                  index % 2 === 0 ? "bg-white" : "bg-gray-50"
                } hover:bg-blue-50`}
              >
                {/* Foto */}
                <div className="w-28 py-2 px-2 border-r border-gray-300 flex justify-center items-center">
                  {product.photo ? (
                    <button
                      onClick={() => {
                        setZoomedImage(product.photo!);
                        setImageZoomVisible(true);
                      }}
                      className="hover:opacity-75"
                    >
                      <img
                        src={product.photo}
                        alt={product.name}
                        className="w-20 h-20 rounded object-cover"
                      />
                    </button>
                  ) : (
                    <div className="w-20 h-20 bg-gray-200 rounded flex justify-center items-center">
                      <p className="text-gray-400 text-xs">Sin foto</p>
                    </div>
                  )}
                </div>
                {/* Nombre */}
                <div className="flex-3 py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center line-clamp-2">
                    {product.name}
                  </p>
                </div>

                {/* SKU */}
                <div className="flex-[1.5] py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center">
                    {product.sku}
                  </p>
                </div>

                {/* Proveedor */}
                <div className="flex-2 py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center truncate">
                    {product.supplier?.name || "—"}
                  </p>
                </div>

                {/* Categoría */}
                <div className="flex-2 py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center truncate">
                    {typeof product.category === "object" && product.category?.name
                      ? product.category.name
                      : product.category || "—"}
                  </p>
                </div>

                {/* Peso */}
                <div className="flex-[1.2] py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center">
                    {product.weight_kg}
                  </p>
                </div>

                {/* Stock */}
                <div className="flex-1 py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center">
                    {product.stock}
                  </p>
                </div>

                {/* Precio */}
                <div className="flex-[1.2] py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center">
                    ${parseFloat(String(product.price)).toFixed(2)}
                  </p>
                </div>

                {/* Costo */}
                <div className="flex-[1.2] py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center">
                    ${parseFloat(String(product.cost || 0)).toFixed(2)}
                  </p>
                </div>

                {/* Estándar X Tarima */}
                <div className="flex-[1.3] py-4 px-3 border-r border-gray-300 flex justify-center items-center">
                  <p className="text-gray-900 font-robotoRegular text-base text-center">
                    {product.standard_tarima || "—"}
                  </p>
                </div>

                {/* Acciones */}
                <div className="flex-[1.5] py-2 px-2 flex justify-center items-center flex-row gap-2">
                  <button
                    onClick={() => openEditModal(product)}
                    className="px-3 py-1.5 bg-blue-500 rounded hover:bg-blue-600 text-white text-xs font-robotoMedium"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => openDeleteModal(product)}
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

      {/* Pagination Controls */}
      {!loading && !error && products.length > 0 && totalPages > 1 && (
        <div className="bg-white mx-6 mt-2 mb-4 px-6 py-4 border border-gray-400 border-t-0">
          <div className="flex flex-row items-center justify-between">
            <p className="text-gray-600 font-robotoRegular">
              Página {page} de {totalPages}
            </p>
            <div className="flex flex-row gap-2">
              <button
                onClick={() => fetchProducts(searchText, page - 1)}
                disabled={page === 1}
                className={`px-4 py-2 rounded-lg font-robotoMedium ${
                  page === 1 ? "bg-gray-200 text-gray-400" : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                Anterior
              </button>
              <button
                onClick={() => fetchProducts(searchText, page + 1)}
                disabled={page >= totalPages}
                className={`px-4 py-2 rounded-lg font-robotoMedium ${
                  page >= totalPages ? "bg-gray-200 text-gray-400" : "bg-blue-600 text-white hover:bg-blue-700"
                }`}
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <ProductModal
        visible={modalVisible}
        product={selectedProduct}
        mode={modalMode}
        onClose={() => {
          setModalVisible(false);
          setSelectedProduct(null);
        }}
        onSave={
          modalMode === "create" ? handleCreateProduct : handleUpdateProduct
        }
      />

      <DeleteConfirmModal
        visible={deleteModalVisible}
        productName={productToDelete?.name || ""}
        loading={deleteLoading}
        onConfirm={handleDeleteProduct}
        onCancel={() => {
          setDeleteModalVisible(false);
          setProductToDelete(null);
        }}
      />

      {/* Image Zoom Modal */}
      {imageZoomVisible && (
        <div
          className="fixed inset-0 bg-black/90 flex justify-center items-center z-50"
          onClick={() => setImageZoomVisible(false)}
        >
          <button
            onClick={() => setImageZoomVisible(false)}
            className="absolute top-8 right-8 z-10 bg-white/20 rounded-full p-3 hover:bg-white/30"
          >
            <span className="text-white text-3xl font-bold">✕</span>
          </button>
          {zoomedImage && (
            <img
              src={zoomedImage}
              alt="Zoomed"
              className="w-full h-full object-contain"
            />
          )}
        </div>
      )}
    </div>
  );
}