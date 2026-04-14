import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useDarkMode } from '../context/DarkModeContext';
import { fetchAPI } from '../lib/fetch';
import {
  calcularResultados,
  calcularResumenContenedores,
  sortResultados,
  DEFAULT_PARAMS,
  CONTENEDORES,
  type ModelParams,
  type ProductoResultado,
  type ResumenContenedor,
  type SemaforoStatus,
} from '../lib/inventoryModel';

// ─── localStorage keys ────────────────────────────────────────────────────────
const LS_DEMAND  = 'einter_inv_demanda';
const LS_TRANSIT = 'einter_inv_transito';
const LS_PARAMS  = 'einter_inv_params';

// ─── Helpers de estilo por estado ────────────────────────────────────────────
const STATUS_CFG: Record<SemaforoStatus, {
  label: string; dot: string;
  rowBg: string; badgeBg: string; badgeText: string; border: string;
}> = {
  rojo: {
    label: 'Crítico', dot: '🔴',
    rowBg:    'bg-red-50 dark:bg-red-950/30',
    badgeBg:  'bg-red-100 dark:bg-red-900/50',
    badgeText:'text-red-700 dark:text-red-300',
    border:   'border-l-4 border-l-red-500',
  },
  amarillo: {
    label: 'Alerta', dot: '🟡',
    rowBg:    'bg-yellow-50 dark:bg-yellow-950/20',
    badgeBg:  'bg-yellow-100 dark:bg-yellow-900/40',
    badgeText:'text-yellow-700 dark:text-yellow-300',
    border:   'border-l-4 border-l-yellow-400',
  },
  verde: {
    label: 'OK', dot: '🟢',
    rowBg:    '',
    badgeBg:  'bg-green-100 dark:bg-green-900/40',
    badgeText:'text-green-700 dark:text-green-300',
    border:   'border-l-4 border-l-green-400',
  },
  sin_datos: {
    label: 'Sin datos', dot: '⚫',
    rowBg:    'bg-gray-50 dark:bg-gray-800/30',
    badgeBg:  'bg-gray-100 dark:bg-gray-700',
    badgeText:'text-gray-500 dark:text-gray-400',
    border:   'border-l-4 border-l-gray-300',
  },
  sobrestock: {
    label: 'Sobrestock', dot: '🔵',
    rowBg:    'bg-blue-50 dark:bg-blue-950/20',
    badgeBg:  'bg-blue-100 dark:bg-blue-900/40',
    badgeText:'text-blue-700 dark:text-blue-300',
    border:   'border-l-4 border-l-blue-400',
  },
};

function fmt(n: number, dec = 0) {
  return n.toLocaleString('es-MX', { maximumFractionDigits: dec });
}

function fmtDias(d: number) {
  if (d >= 9999) return '—';
  if (d > 999)   return '+999';
  return fmt(d, 1) + 'd';
}

// ─── Component ────────────────────────────────────────────────────────────────

type TabType = 'semaforo' | 'pedidos' | 'contenedores';

export function InventarioInteligente() {
  useDarkMode();

  // ── State ──────────────────────────────────────────────────────────────────
  const [rawItems, setRawItems]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // Overrides almacenados en localStorage
  const [demanda, setDemanda]     = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_DEMAND) || '{}'); }
    catch { return {}; }
  });
  const [transit, setTransit]     = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(LS_TRANSIT) || '{}'); }
    catch { return {}; }
  });
  const [params, setParams]       = useState<ModelParams>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_PARAMS) || 'null');
      return saved ? { ...DEFAULT_PARAMS, ...saved } : DEFAULT_PARAMS;
    } catch { return DEFAULT_PARAMS; }
  });

  // UI state
  const [tab, setTab]             = useState<TabType>('semaforo');
  const [showConfig, setShowConfig] = useState(false);
  const [search, setSearch]       = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStatus, setFilterStatus]     = useState<SemaforoStatus | ''>('');
  const [page, setPage]           = useState(1);
  const PAGE_SIZE = 50;

  // Inline editing
  const [editingSku, setEditingSku]   = useState<string | null>(null);
  const [editField, setEditField]     = useState<'demanda' | 'transito'>('demanda');
  const [editValue, setEditValue]     = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Fetch todos los productos ──────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all: any[] = [];
      let pg = 1;
      while (true) {
        const res = await fetchAPI(`/api/odoo/productos?page=${pg}&pageSize=100`);
        const items: any[] = res.items || [];
        all.push(...items);
        const total: number = res.total || 0;
        if (all.length >= total || items.length === 0) break;
        pg++;
        if (pg > 30) break; // safety
      }
      setRawItems(all);
      setPage(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Persistir cambios en localStorage ────────────────────────────────────
  useEffect(() => { localStorage.setItem(LS_DEMAND,  JSON.stringify(demanda));  }, [demanda]);
  useEffect(() => { localStorage.setItem(LS_TRANSIT, JSON.stringify(transit));  }, [transit]);
  useEffect(() => { localStorage.setItem(LS_PARAMS,  JSON.stringify(params));   }, [params]);

  // ── Calcular resultados ────────────────────────────────────────────────────
  const resultados: ProductoResultado[] = useMemo(() => {
    const inputs = rawItems.map((item) => ({
      sku:           item.master_sku ?? String(item.id_articulo),
      name:          item.nombre_producto ?? '',
      supplier:      item.proveedor_nombre || 'Sin proveedor',
      supplierId:    item.id_proveedor,
      stock:         Number(item.existencias) || 0,
      weightKg:      Number(item.peso_kg) || 0,
      standardTarima: item.inventario_standar_tarima
                        ? Number(item.inventario_standar_tarima)
                        : undefined,
      dimensionsCm:
        item.largo_cm || item.ancho_cm || item.alto_cm
          ? { largo: Number(item.largo_cm) || 0,
              ancho: Number(item.ancho_cm) || 0,
              alto:  Number(item.alto_cm)  || 0 }
          : undefined,
      pzsEnTransito: transit[item.master_sku] || 0,
      demandaDiaria: demanda[item.master_sku] || 0,
    }));
    return sortResultados(calcularResultados(inputs, params));
  }, [rawItems, demanda, transit, params]);

  // ── Conteos de semáforo ───────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { rojo: 0, amarillo: 0, verde: 0, sin_datos: 0, sobrestock: 0 };
    for (const r of resultados) c[r.semaforo]++;
    return c;
  }, [resultados]);

  // ── Lista de proveedores únicos ───────────────────────────────────────────
  const suppliers = useMemo(
    () => [...new Set(resultados.map((r) => r.supplier))].sort(),
    [resultados]
  );

  // ── Filtrado ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = resultados;
    if (filterStatus) list = list.filter((r) => r.semaforo === filterStatus);
    if (filterSupplier) list = list.filter((r) => r.supplier === filterSupplier);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (r) => r.sku.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [resultados, filterStatus, filterSupplier, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filterStatus, filterSupplier, search]);

  // ── Resumen contenedores ──────────────────────────────────────────────────
  const contenedores: ResumenContenedor[] = useMemo(
    () => calcularResumenContenedores(resultados, params),
    [resultados, params]
  );

  // ── Inline editing ────────────────────────────────────────────────────────
  const startEdit = (sku: string, field: 'demanda' | 'transito') => {
    setEditingSku(sku);
    setEditField(field);
    setEditValue(
      String(field === 'demanda' ? (demanda[sku] || '') : (transit[sku] || ''))
    );
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commitEdit = () => {
    if (!editingSku) return;
    const val = parseFloat(editValue);
    if (!isNaN(val) && val >= 0) {
      if (editField === 'demanda') {
        setDemanda((prev) => ({ ...prev, [editingSku]: val }));
      } else {
        setTransit((prev) => ({ ...prev, [editingSku]: Math.round(val) }));
      }
    }
    setEditingSku(null);
  };

  const cancelEdit = () => setEditingSku(null);

  // ── Actualizar params ─────────────────────────────────────────────────────
  const updateParam = (key: keyof ModelParams, value: string) => {
    const num = parseFloat(value);
    setParams((prev) => ({ ...prev, [key]: isNaN(num) ? prev[key] : num }));
  };

  const sinDatosCount = counts.sin_datos;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full bg-gray-50 dark:bg-gray-900 flex flex-col min-h-screen">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              🧠 Inventario Inteligente
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Modelo predictivo de reabastecimiento · {rawItems.length} productos cargados
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                showConfig
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              ⚙️ Parámetros
            </button>
            <button
              onClick={fetchAll}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-all disabled:opacity-60"
            >
              {loading ? '⏳ Cargando…' : '🔄 Actualizar'}
            </button>
          </div>
        </div>

        {/* Config Panel */}
        {showConfig && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 bg-gray-50 dark:bg-gray-850">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Parámetros del modelo
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {(
                [
                  { key: 'leadTimeDias',    label: 'Lead time (días)'        },
                  { key: 'diasObjetivo',    label: 'Cobertura objetivo (días)'},
                  { key: 'alertaRojo',      label: 'Umbral crítico (días)'   },
                  { key: 'alertaAmarillo',  label: 'Umbral alerta (días)'    },
                  { key: 'minPzsSku',       label: 'Mín. piezas / SKU'       },
                ] as { key: keyof ModelParams; label: string }[]
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                  <input
                    type="number"
                    value={params[key] as number}
                    onChange={(e) => updateParam(key, e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tipo contenedor</label>
                <select
                  value={params.tipoContenedor}
                  onChange={(e) =>
                    setParams((prev) => ({ ...prev, tipoContenedor: e.target.value as any }))
                  }
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                >
                  {Object.keys(CONTENEDORES).map((k) => (
                    <option key={k} value={k}>{k}&apos;</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
              * Peso y volumen son estimados. Para mayor precisión se requieren datos logísticos (piezas/caja, peso/caja).
            </p>
          </div>
        )}
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {(
          [
            { key: 'rojo',       label: 'Crítico',    color: 'red'   },
            { key: 'amarillo',   label: 'Alerta',     color: 'yellow'},
            { key: 'verde',      label: 'OK',         color: 'green' },
            { key: 'sin_datos',  label: 'Sin datos',  color: 'gray'  },
            { key: 'sobrestock', label: 'Sobrestock', color: 'blue'  },
          ] as { key: SemaforoStatus; label: string; color: string }[]
        ).map(({ key, label }) => {
          const cfg = STATUS_CFG[key];
          const active = filterStatus === key;
          return (
            <button
              key={key}
              onClick={() => setFilterStatus(active ? '' : key)}
              className={`rounded-xl p-4 text-left transition-all hover:scale-[1.02] border-2 ${
                active
                  ? `${cfg.badgeBg} border-current`
                  : 'bg-white dark:bg-gray-800 border-transparent hover:border-gray-200 dark:hover:border-gray-600 shadow-sm'
              }`}
            >
              <div className="text-2xl font-bold text-gray-800 dark:text-gray-100">
                {fmt(counts[key])}
              </div>
              <div className={`text-sm font-medium mt-0.5 ${cfg.badgeText}`}>
                {cfg.dot} {label}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Info banner: sin datos de demanda ─────────────────────────────── */}
      {sinDatosCount > 0 && (
        <div className="mx-6 mb-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-800 dark:text-amber-300">
          <strong>ℹ️ {sinDatosCount} productos sin demanda configurada.</strong>{' '}
          Haz clic en la columna <em>Dem./día</em> de cualquier fila para ingresar la demanda diaria (piezas/día) y activar el modelo.
          Para conectar el historial de ventas automáticamente, se requiere un endpoint <code>/api/odoo/ventas-por-sku</code>.
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="px-6 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <div className="flex gap-1">
          {(
            [
              { id: 'semaforo',     label: '📊 Semáforo'   },
              { id: 'pedidos',      label: '📦 Pedidos'    },
              { id: 'contenedores', label: '🚢 Contenedores'},
            ] as { id: TabType; label: string }[]
          ).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300">
          ❌ {error}
        </div>
      )}

      {loading && rawItems.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="text-4xl mb-4 animate-bounce">🧠</div>
            <p className="text-gray-500 dark:text-gray-400">Cargando productos…</p>
          </div>
        </div>
      ) : (
        <>
          {/* ── Semáforo Tab ─────────────────────────────────────────────── */}
          {tab === 'semaforo' && (
            <SemaforoTab
              paginated={paginated}
              filtered={filtered}
              suppliers={suppliers}
              filterSupplier={filterSupplier}
              filterStatus={filterStatus}
              search={search}
              page={page}
              totalPages={totalPages}
              PAGE_SIZE={PAGE_SIZE}
              editingSku={editingSku}
              editField={editField}
              editValue={editValue}
              inputRef={inputRef}
              onSearchChange={(v) => setSearch(v)}
              onSupplierChange={(v) => setFilterSupplier(v)}
              onStatusChange={(v) => setFilterStatus(v as SemaforoStatus | '')}
              onStartEdit={startEdit}
              onEditValueChange={setEditValue}
              onCommitEdit={commitEdit}
              onCancelEdit={cancelEdit}
              onPageChange={setPage}
            />
          )}

          {/* ── Pedidos Tab ───────────────────────────────────────────────── */}
          {tab === 'pedidos' && (
            <PedidosTab resultados={resultados} />
          )}

          {/* ── Contenedores Tab ─────────────────────────────────────────── */}
          {tab === 'contenedores' && (
            <ContenedoresTab
              contenedores={contenedores}
              tipoContenedor={params.tipoContenedor}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Semáforo Tab ─────────────────────────────────────────────────────────────

interface SemaforoTabProps {
  paginated: ProductoResultado[];
  filtered: ProductoResultado[];
  suppliers: string[];
  filterSupplier: string;
  filterStatus: SemaforoStatus | '';
  search: string;
  page: number;
  totalPages: number;
  PAGE_SIZE: number;
  editingSku: string | null;
  editField: 'demanda' | 'transito';
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSearchChange: (v: string) => void;
  onSupplierChange: (v: string) => void;
  onStatusChange: (v: string) => void;
  onStartEdit: (sku: string, field: 'demanda' | 'transito') => void;
  onEditValueChange: (v: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onPageChange: (p: number) => void;
}

function SemaforoTab({
  paginated, filtered, suppliers,
  filterSupplier, filterStatus, search,
  page, totalPages, PAGE_SIZE,
  editingSku, editField, editValue, inputRef,
  onSearchChange, onSupplierChange, onStatusChange,
  onStartEdit, onEditValueChange, onCommitEdit, onCancelEdit, onPageChange,
}: SemaforoTabProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 px-6 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          placeholder="🔍 Buscar SKU o nombre…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 w-56"
        />
        <select
          value={filterSupplier}
          onChange={(e) => onSupplierChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
        >
          <option value="">Todos los proveedores</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => onStatusChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => (
            <option key={k} value={k}>{v.dot} {v.label}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 self-center">
          {filtered.length} productos
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs uppercase tracking-wide">
              <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600 w-8">#</th>
              <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600 min-w-[80px]">SKU</th>
              <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600 min-w-[200px]">Nombre</th>
              <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600 min-w-[100px]">Proveedor</th>
              <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Stock</th>
              <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600" title="Piezas en tránsito — clic para editar">
                Tránsito ✏️
              </th>
              <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Inv. ef.</th>
              <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600" title="Demanda diaria (piezas/día) — clic en celda para editar">
                Dem./día ✏️
              </th>
              <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Días cob.</th>
              <th className="px-3 py-2.5 text-center border-b border-r border-gray-300 dark:border-gray-600 min-w-[100px]">Estado</th>
              <th className="px-3 py-2.5 text-right border-b border-gray-300 dark:border-gray-600">→ Rojo</th>
            </tr>
          </thead>
          <tbody>
            {paginated.map((r, idx) => {
              const cfg = STATUS_CFG[r.semaforo];
              const globalIdx = (page - 1) * PAGE_SIZE + idx + 1;
              return (
                <tr
                  key={r.sku}
                  className={`border-b border-gray-200 dark:border-gray-700 hover:brightness-95 transition-all ${cfg.rowBg} ${cfg.border}`}
                >
                  <td className="px-3 py-2 text-gray-400 dark:text-gray-500 border-r border-gray-200 dark:border-gray-700 text-center">
                    {globalIdx}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap">
                    {r.sku}
                  </td>
                  <td className="px-3 py-2 text-gray-800 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700 max-w-xs truncate" title={r.name}>
                    {r.name}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700 whitespace-nowrap">
                    {r.supplier}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-800 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">
                    {fmt(r.stock)}
                  </td>

                  {/* Tránsito — editable */}
                  <td
                    className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700 cursor-pointer"
                    onClick={() => onStartEdit(r.sku, 'transito')}
                  >
                    {editingSku === r.sku && editField === 'transito' ? (
                      <input
                        ref={inputRef}
                        type="number"
                        min="0"
                        value={editValue}
                        onChange={(e) => onEditValueChange(e.target.value)}
                        onBlur={onCommitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onCommitEdit();
                          if (e.key === 'Escape') onCancelEdit();
                        }}
                        className="w-20 px-1 py-0.5 text-right border border-blue-400 rounded text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className={r.pzsEnTransito > 0 ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-300 dark:text-gray-600'}>
                        {r.pzsEnTransito > 0 ? fmt(r.pzsEnTransito) : '—'}
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">
                    {fmt(r.invEfectivo)}
                  </td>

                  {/* Demanda diaria — editable */}
                  <td
                    className="px-3 py-2 text-right border-r border-gray-200 dark:border-gray-700 cursor-pointer"
                    onClick={() => onStartEdit(r.sku, 'demanda')}
                    title="Clic para editar demanda diaria"
                  >
                    {editingSku === r.sku && editField === 'demanda' ? (
                      <input
                        ref={inputRef}
                        type="number"
                        min="0"
                        step="0.1"
                        value={editValue}
                        onChange={(e) => onEditValueChange(e.target.value)}
                        onBlur={onCommitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') onCommitEdit();
                          if (e.key === 'Escape') onCancelEdit();
                        }}
                        className="w-20 px-1 py-0.5 text-right border border-blue-400 rounded text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className={
                          r.demandaDiaria > 0
                            ? 'text-gray-800 dark:text-gray-200 font-medium'
                            : 'text-gray-300 dark:text-gray-600 italic text-xs'
                        }
                      >
                        {r.demandaDiaria > 0
                          ? r.demandaDiaria.toFixed(1)
                          : 'editar'}
                      </span>
                    )}
                  </td>

                  {/* Días cobertura */}
                  <td className={`px-3 py-2 text-right font-semibold border-r border-gray-200 dark:border-gray-700 ${cfg.badgeText}`}>
                    {fmtDias(r.diasInventario)}
                  </td>

                  {/* Estado badge */}
                  <td className="px-3 py-2 text-center border-r border-gray-200 dark:border-gray-700">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badgeBg} ${cfg.badgeText}`}>
                      {cfg.dot} {cfg.label}
                    </span>
                  </td>

                  {/* Fecha → rojo */}
                  <td className="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {r.semaforo === 'verde' && r.fechaRojo
                      ? r.fechaRojo
                      : r.semaforo === 'rojo' || r.semaforo === 'amarillo'
                      ? <span className="text-red-500 dark:text-red-400 font-medium">¡Ya!</span>
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🔍</div>
            <p>Sin resultados para los filtros actuales.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Página {page} de {totalPages} · {filtered.length} productos
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              ‹ Ant.
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pg = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
              return (
                <button
                  key={pg}
                  onClick={() => onPageChange(pg)}
                  className={`px-3 py-1 text-sm rounded border ${
                    pg === page
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Sig. ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pedidos Tab ──────────────────────────────────────────────────────────────

function PedidosTab({ resultados }: { resultados: ProductoResultado[] }) {
  const pedidos = resultados.filter(
    (r) => r.semaforo === 'rojo' || r.semaforo === 'amarillo'
  );
  const totalPeso = pedidos.reduce((s, r) => s + r.pesoKg, 0);
  const totalVol  = pedidos.reduce((s, r) => s + r.volumenM3, 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {pedidos.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-400 dark:text-gray-500">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-lg">Sin pedidos urgentes.</p>
          <p className="text-sm mt-1">Todos los productos están en nivel OK o sobrestock.</p>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div className="px-6 py-3 flex flex-wrap gap-4 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm">
            <span className="text-gray-600 dark:text-gray-400">
              <strong className="text-gray-900 dark:text-gray-100">{pedidos.length}</strong> SKUs a pedir
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              Peso total estimado: <strong className="text-gray-900 dark:text-gray-100">{fmt(totalPeso, 1)} kg</strong>
            </span>
            <span className="text-gray-600 dark:text-gray-400">
              Volumen total estimado: <strong className="text-gray-900 dark:text-gray-100">{fmt(totalVol, 2)} m³</strong>
            </span>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0">
                <tr className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs uppercase tracking-wide">
                  <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600">SKU</th>
                  <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600">Nombre</th>
                  <th className="px-3 py-2.5 text-left border-b border-r border-gray-300 dark:border-gray-600">Proveedor</th>
                  <th className="px-3 py-2.5 text-center border-b border-r border-gray-300 dark:border-gray-600">Estado</th>
                  <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Stock</th>
                  <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Dem./día</th>
                  <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Días cob.</th>
                  <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Pzs necesarias</th>
                  <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Pzs a pedir</th>
                  <th className="px-3 py-2.5 text-right border-b border-r border-gray-300 dark:border-gray-600">Peso est. (kg)</th>
                  <th className="px-3 py-2.5 text-right border-b border-gray-300 dark:border-gray-600">Vol. est. (m³)</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((r) => {
                  const cfg = STATUS_CFG[r.semaforo];
                  return (
                    <tr
                      key={r.sku}
                      className={`border-b border-gray-200 dark:border-gray-700 ${cfg.rowBg} ${cfg.border}`}
                    >
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">{r.sku}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700 max-w-xs truncate" title={r.name}>{r.name}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">{r.supplier}</td>
                      <td className="px-3 py-2 text-center border-r border-gray-200 dark:border-gray-700">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.badgeBg} ${cfg.badgeText}`}>
                          {cfg.dot} {cfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200 border-r border-gray-200 dark:border-gray-700">{fmt(r.stock)}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">{r.demandaDiaria.toFixed(1)}</td>
                      <td className={`px-3 py-2 text-right font-bold border-r border-gray-200 dark:border-gray-700 ${cfg.badgeText}`}>
                        {fmtDias(r.diasInventario)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">{fmt(r.pzsNecesarias)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-700 dark:text-blue-300 border-r border-gray-200 dark:border-gray-700">{fmt(r.pzsAPedir)}</td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300 border-r border-gray-200 dark:border-gray-700">
                        {r.pesoKg > 0 ? fmt(r.pesoKg, 1) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700 dark:text-gray-300">
                        {r.volumenM3 > 0 ? fmt(r.volumenM3, 3) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Contenedores Tab ─────────────────────────────────────────────────────────

function ContenedoresTab({
  contenedores,
  tipoContenedor,
}: {
  contenedores: ResumenContenedor[];
  tipoContenedor: string;
}) {
  if (contenedores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-gray-400 dark:text-gray-500">
        <div className="text-5xl mb-3">🚢</div>
        <p className="text-lg">Sin pedidos pendientes.</p>
        <p className="text-sm mt-1">Configura la demanda diaria para ver el llenado de contenedores.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Estimación de llenado del contenedor <strong>{tipoContenedor}&apos;</strong> por proveedor.
        Solo incluye SKUs en estado Crítico o Alerta con demanda configurada.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {contenedores.map((c) => {
          const weightColor =
            c.pctPeso >= 80
              ? 'bg-green-500'
              : c.pctPeso >= 50
              ? 'bg-yellow-500'
              : c.pctPeso >= 30
              ? 'bg-orange-500'
              : 'bg-red-400';
          const volColor =
            c.pctVol >= 80
              ? 'bg-green-500'
              : c.pctVol >= 50
              ? 'bg-yellow-500'
              : c.pctVol >= 30
              ? 'bg-orange-500'
              : 'bg-red-400';
          return (
            <div
              key={c.supplier}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-gray-800 dark:text-gray-100 text-lg">
                  🏭 {c.supplier}
                </h3>
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-1 rounded-full">
                  Contenedor {c.tipoContenedor}&apos;
                </span>
              </div>

              {/* Peso bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>⚖️ Peso</span>
                  <span>
                    {fmt(c.pesoTotalKg, 1)} / {fmt(c.pesoMaxKg)} kg{' '}
                    <strong className={c.pctPeso >= 80 ? 'text-green-600 dark:text-green-400' : 'text-orange-500'}>{c.pctPeso}%</strong>
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3.5 overflow-hidden">
                  <div
                    className={`h-3.5 rounded-full transition-all ${weightColor}`}
                    style={{ width: `${Math.min(c.pctPeso, 100)}%` }}
                  />
                </div>
              </div>

              {/* Volumen bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                  <span>📦 Volumen</span>
                  <span>
                    {fmt(c.volumenTotalM3, 2)} / {fmt(c.volMaxM3)} m³{' '}
                    <strong className={c.pctVol >= 80 ? 'text-green-600 dark:text-green-400' : 'text-orange-500'}>{c.pctVol}%</strong>
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3.5 overflow-hidden">
                  <div
                    className={`h-3.5 rounded-full transition-all ${volColor}`}
                    style={{ width: `${Math.min(c.pctVol, 100)}%` }}
                  />
                </div>
              </div>

              {/* Productos list */}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  {c.productos.length} SKUs incluidos
                </p>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {c.productos.map((p) => {
                    const cfg = STATUS_CFG[p.semaforo];
                    return (
                      <div
                        key={p.sku}
                        className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-700/50 rounded px-2 py-1.5"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span>{cfg.dot}</span>
                          <span className="font-mono text-gray-600 dark:text-gray-400 shrink-0">{p.sku}</span>
                          <span className="text-gray-700 dark:text-gray-300 truncate">{p.name}</span>
                        </div>
                        <div className="flex gap-3 shrink-0 ml-2 text-gray-500 dark:text-gray-400">
                          <span>{fmt(p.pzsAPedir)} pzs</span>
                          {p.pesoKg > 0 && <span>{fmt(p.pesoKg, 0)} kg</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {c.pctPeso < 80 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                  ⚠️ Llenado bajo el 80% ({c.pctPeso}%). Considera agregar productos verdes de este proveedor para optimizar el contenedor.
                </p>
              )}
              {c.pctPeso > 100 && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-3">
                  🚨 El pedido supera la capacidad del contenedor ({c.pctPeso}%). Divide el envío en múltiples contenedores.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
