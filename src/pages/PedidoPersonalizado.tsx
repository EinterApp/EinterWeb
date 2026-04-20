import { useState, useEffect, useCallback } from 'react';
import { useDarkMode } from '../context/DarkModeContext';
import { fetchAPI } from '../lib/fetch';
import {
  ALL_CONTAINER_TYPES,
  getContainerType,
  calcularNMin,
  calcularCajasMaxRelleno,
  clasificarSemaforo,
  resolverPedido,
  recomendarTipo,
  generarTopOff,
  aplicarTopOff,
  resolverEscenarioA,
  getBinStats,
  type ContainerName,
  type ContainerType,
  type Ancla,
  type CandidatoRelleno,
  type PackingResult,
  type EvaluacionTipo,
  type TopOffSugerencia,
  type AnclaConContexto,
  type ScenarioAResult,
  type BinState,
} from '../lib/packingEngine';

// ─── Constantes ────────────────────────────────────────────────────────────────

const LEAD_TIME_DIAS = 60;
const DIAS_OBJETIVO  = 150;
const LS_DEMAND      = 'einter_inv_demanda';
const LS_TRANSIT     = 'einter_inv_transito';

// ─── Tipos internos ────────────────────────────────────────────────────────────

interface SkuCatalogo {
  sku:         number;
  skuStr:      string;
  desc:        string;
  supplier:    string;
  supplierId:  number;
  invActual:   number;
  pzsCaja:     number;   // inventario_standar_tarima
  pesoCaja:    number;   // kg/caja
  volCaja:     number;   // m³/caja
  dI:          number;   // demanda piezas/día
  invEfectivo: number;
  cobDias:     number;
  semaforo:    string;
  cajasMax:    number;
}

type Step = 'loading' | 'supplier' | 'anchors' | 'nmax' | 'container' | 'results';

// ─── Helpers de estilo ────────────────────────────────────────────────────────

const SEM_CFG: Record<string, { label: string; dot: string; badge: string; text: string }> = {
  CRITICO:    { label: 'Crítico',    dot: '🔴', badge: 'bg-red-100 dark:bg-red-900/40',    text: 'text-red-700 dark:text-red-300' },
  ALERTA:     { label: 'Alerta',     dot: '🟡', badge: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-700 dark:text-yellow-300' },
  OK:         { label: 'OK',         dot: '🟢', badge: 'bg-green-100 dark:bg-green-900/40',  text: 'text-green-700 dark:text-green-300' },
  SOBRESTOCK: { label: 'Sobrestock', dot: '⚠️', badge: 'bg-blue-100 dark:bg-blue-900/40',   text: 'text-blue-700 dark:text-blue-300' },
};

const ESTADO_BIN: Record<string, { label: string; color: string; icon: string }> = {
  valid:    { label: 'En ventana', color: 'text-green-600 dark:text-green-400',  icon: '✔' },
  optimal:  { label: 'Óptimo',    color: 'text-blue-600 dark:text-blue-400',    icon: '🔷' },
  degraded: { label: 'Degradado', color: 'text-yellow-600 dark:text-yellow-400', icon: '⚠' },
  invalid:  { label: 'Inválido',  color: 'text-red-600 dark:text-red-400',      icon: '✖' },
};

function binEstado(stats: ReturnType<typeof getBinStats>): keyof typeof ESTADO_BIN {
  if (stats.enVentana && !stats.optimo)  return 'valid';
  if (stats.optimo)                      return 'optimal';
  if (stats.degraded)                    return 'degraded';
  return 'invalid';
}

function fmt(n: number, dec = 0) {
  return n.toLocaleString('es-MX', { maximumFractionDigits: dec });
}

function PctBar({ val, low, high }: { val: number; low: number; high: number }) {
  const clamp = Math.min(100, Math.max(0, val));
  const inRange = val >= low && val <= high;
  const tooLow  = val < low;
  const color = inRange ? 'bg-green-500' : tooLow ? 'bg-red-400' : 'bg-blue-500';
  return (
    <div className="relative h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden w-full">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${clamp}%` }} />
      <div className="absolute top-0 h-full w-px bg-gray-400 dark:bg-gray-500" style={{ left: `${low}%` }} />
      <div className="absolute top-0 h-full w-px bg-gray-400 dark:bg-gray-500" style={{ left: `${Math.min(high, 100)}%` }} />
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function PedidoPersonalizado() {
  useDarkMode();

  // ── Datos ─────────────────────────────────────────────────────────────────
  const [catalogo,    setCatalogo]    = useState<SkuCatalogo[]>([]);
  const [proveedores, setProveedores] = useState<{ id: number; nombre: string }[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  // ── Wizard state ──────────────────────────────────────────────────────────
  const [step,          setStep]          = useState<Step>('loading');
  const [supplier,      setSupplier]      = useState<string>('');
  const [anclas,        setAnclas]        = useState<Ancla[]>([]);
  const [nMax,          setNMax]          = useState<number>(3);
  const [nMaxInput,     setNMaxInput]     = useState<string>('3');
  const [ctype,         setCtype]         = useState<ContainerType>(getContainerType('40HC'));
  const [evaluaciones,  setEvaluaciones]  = useState<EvaluacionTipo[]>([]);
  const [packResult,    setPackResult]    = useState<PackingResult | null>(null);
  const [scenarioA,     setScenarioA]     = useState<ScenarioAResult | null>(null);
  const [topOff,        setTopOff]        = useState<TopOffSugerencia[]>([]);
  const [topOffApplied, setTopOffApplied] = useState(false);
  const [resultBins,    setResultBins]    = useState<BinState[]>([]);

  // ── Ancla form ────────────────────────────────────────────────────────────
  const [anclaSkuInput,  setAnclaSkuInput]  = useState<string>('');
  const [anclaQtyInput,  setAnclaQtyInput]  = useState<string>('');
  const [anclaUnidad,    setAnclaUnidad]    = useState<'piezas' | 'cajas'>('piezas');
  const [anclaError,     setAnclaError]     = useState<string | null>(null);
  const [catalogSearch,  setCatalogSearch]  = useState<string>('');

  // ── Cargar productos ──────────────────────────────────────────────────────
  const cargarCatalogo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Cargar overrides de localStorage
      let demanda: Record<string, number> = {};
      let transit: Record<string, number> = {};
      try { demanda = JSON.parse(localStorage.getItem(LS_DEMAND)  || '{}'); } catch {}
      try { transit = JSON.parse(localStorage.getItem(LS_TRANSIT) || '{}'); } catch {}

      // Cargar proveedores y productos en paralelo
      const [provRes, ...productBatches] = await Promise.all([
        fetchAPI('/api/odoo/proveedores?pageSize=500'),
        fetchAPI('/api/odoo/productos?page=1&pageSize=100'),
      ]);

      setProveedores(
        (provRes.items || []).map((p: any) => ({ id: p.id_proveedor, nombre: p.nombre }))
      );

      // Paginar resto de productos
      const firstBatch = productBatches[0];
      const items: any[] = firstBatch.items || [];
      const total: number = firstBatch.total || 0;
      let page = 2;
      while (items.length < total) {
        const res = await fetchAPI(`/api/odoo/productos?page=${page}&pageSize=100`);
        const batch: any[] = res.items || [];
        items.push(...batch);
        if (batch.length === 0 || page > 30) break;
        page++;
      }

      const skus: SkuCatalogo[] = items
        .filter(item => {
          const std = Number(item.inventario_standar_tarima) || 0;
          return std > 0;
        })
        .map(item => {
          const skuStr     = item.master_sku ?? String(item.id_articulo ?? '');
          const skuNum     = parseInt(skuStr, 10) || 0;
          const pzsCaja    = Number(item.inventario_standar_tarima) || 1;
          const pesoUnitKg = Number(item.peso_kg) || 0;
          const pesoCaja   = pesoUnitKg * pzsCaja;
          const largo      = Number(item.largo_cm) || 0;
          const ancho      = Number(item.ancho_cm) || 0;
          const alto       = Number(item.alto_cm)  || 0;
          const volUnitM3  = largo && ancho && alto ? (largo * ancho * alto) / 1_000_000 : 0;
          const volCaja    = volUnitM3 * pzsCaja;
          const invActual  = Number(item.existencias) || 0;
          const pzsTrans   = transit[skuStr] || 0;
          const invEfectivo = invActual + pzsTrans;
          const dI         = demanda[skuStr] || 0;
          const cobDias    = dI > 0 ? invEfectivo / dI : 9999;
          const semaforo   = clasificarSemaforo(cobDias);
          const cajasMax   = calcularCajasMaxRelleno(invEfectivo, dI, pzsCaja);

          return {
            sku:      skuNum,
            skuStr,
            desc:     item.nombre_producto ?? '',
            supplier: (item.proveedor_nombre ?? 'Sin proveedor').trim(),
            supplierId: Number(item.id_proveedor) || 0,
            invActual,
            pzsCaja,
            pesoCaja: pesoCaja > 0 ? pesoCaja : 0.1,
            volCaja:  volCaja  > 0 ? volCaja  : 0.001,
            dI,
            invEfectivo,
            cobDias,
            semaforo,
            cajasMax,
          } as SkuCatalogo;
        });

      setCatalogo(skus);
      setStep('supplier');
    } catch (e: any) {
      setError(e.message || 'Error al cargar productos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargarCatalogo(); }, [cargarCatalogo]);

  // ── Suppliers disponibles ─────────────────────────────────────────────────
  // Usar lista completa de proveedores del endpoint; si aún no cargó, derivar del catálogo
  const supplierNames = proveedores.length > 0
    ? proveedores.map(p => p.nombre).sort()
    : Array.from(new Set(catalogo.map(s => s.supplier))).sort();

  const supplierStats = supplierNames.map(sup => {
    const skus = catalogo.filter(s => s.supplier === sup);
    return {
      supplier:   sup,
      total:      skus.length,
      critico:    skus.filter(s => s.semaforo === 'CRITICO').length,
      alerta:     skus.filter(s => s.semaforo === 'ALERTA').length,
      ok:         skus.filter(s => s.semaforo === 'OK').length,
      sobrestock: skus.filter(s => s.semaforo === 'SOBRESTOCK').length,
    };
  });

  // ── Catálogo del proveedor seleccionado ───────────────────────────────────
  const catalogoProv = catalogo.filter(s => s.supplier === supplier);
  const catalogoFiltrado = catalogSearch
    ? catalogoProv.filter(s =>
        s.skuStr.includes(catalogSearch) ||
        s.desc.toLowerCase().includes(catalogSearch.toLowerCase())
      )
    : catalogoProv;

  // ── Agregar ancla ─────────────────────────────────────────────────────────
  function agregarAncla() {
    setAnclaError(null);
    const skuNum = parseInt(anclaSkuInput, 10);
    const qty    = parseInt(anclaQtyInput, 10);

    if (isNaN(skuNum) || skuNum <= 0) { setAnclaError('SKU inválido'); return; }
    if (isNaN(qty) || qty <= 0)       { setAnclaError('Cantidad debe ser > 0'); return; }

    const row = catalogoProv.find(s => s.sku === skuNum || s.skuStr === anclaSkuInput.trim());
    if (!row) { setAnclaError(`SKU ${anclaSkuInput} no pertenece a este proveedor`); return; }

    if (row.semaforo === 'SOBRESTOCK') {
      if (!window.confirm(`SKU ${anclaSkuInput} está en SOBRESTOCK. ¿Continuar?`)) return;
    }

    const cajas = anclaUnidad === 'cajas'
      ? qty
      : Math.max(1, Math.ceil(qty / row.pzsCaja));

    if (cajas <= 0) { setAnclaError('La cantidad resulta en 0 cajas'); return; }

    setAnclas(prev => {
      const exists = prev.find(a => a.sku === row.sku);
      if (exists) {
        return prev.map(a => a.sku === row.sku ? { ...a, cajas: a.cajas + cajas } : a);
      }
      return [...prev, {
        sku: row.sku, cajas, pesoCaja: row.pesoCaja,
        volCaja: row.volCaja, pzsCaja: row.pzsCaja, desc: row.desc,
      }];
    });
    setAnclaSkuInput('');
    setAnclaQtyInput('');
  }

  function quitarAncla(sku: number) {
    setAnclas(prev => prev.filter(a => a.sku !== sku));
  }

  // ── Calcular y resolver ───────────────────────────────────────────────────
  function calcularCandidatos(skusAncla: Set<number>): CandidatoRelleno[] {
    return catalogoProv
      .filter(s => !skusAncla.has(s.sku) && s.semaforo !== 'SOBRESTOCK' && s.cajasMax > 0)
      .map(s => ({
        sku:      s.sku,
        dI:       s.dI,
        cobDias:  s.cobDias,
        estado:   s.semaforo,
        pesoCaja: s.pesoCaja,
        volCaja:  s.volCaja,
        pzsCaja:  s.pzsCaja,
        cajasMax: s.cajasMax,
        desc:     s.desc,
      }));
  }

  function irAContenedor() {
    const candidatos = calcularCandidatos(new Set(anclas.map(a => a.sku)));
    const { recomendado, evaluaciones: evals } = recomendarTipo(anclas, candidatos);
    setEvaluaciones(evals);
    if (recomendado) setCtype(recomendado);
    setStep('container');
  }

  function resolverYMostrar() {
    const candidatos = calcularCandidatos(new Set(anclas.map(a => a.sku)));
    const result = resolverPedido(anclas, candidatos, ctype, nMax);

    if (result.excedeNMax) {
      // Escenario A
      const anclasCtx: AnclaConContexto[] = anclas.map(a => {
        const row = catalogoProv.find(s => s.sku === a.sku)!;
        return { ancla: a, dI: row?.dI ?? 0, cobDias: row?.cobDias ?? 9999, estado: row?.semaforo ?? 'OK' };
      });
      const rA = resolverEscenarioA(anclasCtx, ctype, nMax);
      setScenarioA(rA);
      setPackResult(result);
      setStep('results');
      return;
    }

    // Preparar cajasMaxFallback para top-off
    const anclasConFallback: Ancla[] = anclas.map(a => {
      const row = catalogoProv.find(s => s.sku === a.sku)!;
      const cajasMaxTotal = row ? calcularCajasMaxRelleno(row.invEfectivo, row.dI, row.pzsCaja) : 0;
      return { ...a, cajasMaxFallback: Math.max(0, cajasMaxTotal - a.cajas) };
    });

    const bins = result.config.bins;
    const topOffSugs = generarTopOff(bins, candidatos, anclasConFallback);

    setPackResult(result);
    setResultBins(bins.map(b => ({ ...b, assignments: [...b.assignments.map(a => ({ ...a }))] })));
    setTopOff(topOffSugs);
    setTopOffApplied(false);
    setScenarioA(null);
    setStep('results');
  }

  function aceptarEscenarioAYResolver(ajustadas: Ancla[]) {
    setAnclas(ajustadas);
    const candidatos = calcularCandidatos(new Set(ajustadas.map(a => a.sku)));
    const result = resolverPedido(ajustadas, candidatos, ctype, nMax);
    const bins = result.config.bins;
    const topOffSugs = generarTopOff(bins, candidatos, ajustadas);
    setPackResult(result);
    setResultBins(bins.map(b => ({ ...b, assignments: [...b.assignments.map(a => ({ ...a }))] })));
    setTopOff(topOffSugs);
    setTopOffApplied(false);
    setScenarioA(null);
  }

  function handleAplicarTopOff() {
    if (topOffApplied || !packResult) return;
    const newBins = resultBins.map(b => ({ ...b, assignments: [...b.assignments.map(a => ({ ...a }))] }));
    aplicarTopOff(newBins, topOff);
    setResultBins(newBins);
    setTopOffApplied(true);
  }

  function resetPedido() {
    setAnclas([]);
    setNMax(3);
    setNMaxInput('3');
    setPackResult(null);
    setScenarioA(null);
    setTopOff([]);
    setTopOffApplied(false);
    setResultBins([]);
    setStep('supplier');
  }

  // ── Stepper ───────────────────────────────────────────────────────────────
  const STEPS = [
    { key: 'supplier',   label: 'Proveedor' },
    { key: 'anchors',    label: 'Anclas' },
    { key: 'nmax',       label: 'Límite' },
    { key: 'container',  label: 'Contenedor' },
    { key: 'results',    label: 'Resultado' },
  ];
  const stepIdx = STEPS.findIndex(s => s.key === step);

  // ── Render ────────────────────────────────────────────────────────────────
  if (step === 'loading') {
    return (
      <div className="p-6 min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center gap-4">
        {loading && (
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-600 dark:text-gray-400">Cargando catálogo...</p>
          </div>
        )}
        {error && (
          <div className="max-w-md text-center">
            <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
            <button onClick={cargarCatalogo} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
              Reintentar
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-16">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-6 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Pedido Personalizado</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Motor de cubicaje v1.2</p>
          </div>
          {step !== 'supplier' && (
            <button onClick={resetPedido} className="text-sm text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400 transition-colors">
              ✕ Nuevo pedido
            </button>
          )}
        </div>

        {/* Stepper */}
        {step !== 'loading' && (
          <div className="max-w-5xl mx-auto mt-3 flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1 flex-1">
                <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  i < stepIdx  ? 'text-blue-500 dark:text-blue-400'
                  : i === stepIdx ? 'text-blue-600 dark:text-blue-300 font-bold'
                  : 'text-gray-400 dark:text-gray-600'
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                    i < stepIdx  ? 'bg-blue-500 text-white'
                    : i === stepIdx ? 'bg-blue-600 text-white ring-2 ring-blue-300 dark:ring-blue-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                  }`}>
                    {i < stepIdx ? '✓' : i + 1}
                  </div>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-1 ${i < stepIdx ? 'bg-blue-400' : 'bg-gray-200 dark:bg-gray-700'}`} />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* ── PASO 1: Proveedor ──────────────────────────────────────────────── */}
        {step === 'supplier' && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Selecciona un proveedor</h2>
            <div className="grid gap-3">
              {supplierStats.map(s => (
                <button
                  key={s.supplier}
                  onClick={() => { setSupplier(s.supplier); setAnclas([]); setStep('anchors'); }}
                  className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-5 py-4 text-left hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-md transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {s.supplier}
                      </span>
                      <span className="ml-2 text-sm text-gray-400">{s.total} SKUs</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      {s.critico    > 0 && <span className="flex items-center gap-1"><span>🔴</span><span className="text-red-600 dark:text-red-400 font-medium">{s.critico}</span></span>}
                      {s.alerta     > 0 && <span className="flex items-center gap-1"><span>🟡</span><span className="text-yellow-600 dark:text-yellow-400 font-medium">{s.alerta}</span></span>}
                      {s.ok         > 0 && <span className="flex items-center gap-1"><span>🟢</span><span className="text-green-600 dark:text-green-400 font-medium">{s.ok}</span></span>}
                      {s.sobrestock > 0 && <span className="flex items-center gap-1"><span>⚠️</span><span className="text-blue-600 dark:text-blue-400 font-medium">{s.sobrestock}</span></span>}
                      <span className="text-gray-400">→</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── PASO 2: Anclas ────────────────────────────────────────────────── */}
        {step === 'anchors' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Catálogo — {supplier}
              </h2>
              <button onClick={() => setStep('supplier')} className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-500 transition-colors">
                ← Cambiar proveedor
              </button>
            </div>

            {/* Captura de ancla */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Agregar ancla al pedido</p>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">SKU</label>
                  <input
                    type="number"
                    value={anclaSkuInput}
                    onChange={e => setAnclaSkuInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && agregarAncla()}
                    placeholder="Ej. 1234"
                    className="w-32 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Cantidad</label>
                  <input
                    type="number"
                    value={anclaQtyInput}
                    onChange={e => setAnclaQtyInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && agregarAncla()}
                    placeholder="Ej. 5000"
                    className="w-32 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500 dark:text-gray-400">Unidad</label>
                  <select
                    value={anclaUnidad}
                    onChange={e => setAnclaUnidad(e.target.value as 'piezas' | 'cajas')}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="piezas">Piezas</option>
                    <option value="cajas">Cajas</option>
                  </select>
                </div>
                <button
                  onClick={agregarAncla}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  + Agregar
                </button>
              </div>
              {anclaError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{anclaError}</p>}
            </div>

            {/* Pedido actual */}
            {anclas.length > 0 && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Anclas del pedido ({anclas.length})</span>
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {anclas.map(a => {
                    const row = catalogoProv.find(s => s.sku === a.sku);
                    const sem = row ? SEM_CFG[row.semaforo] : null;
                    const pesoTotal = (a.cajas * a.pesoCaja).toFixed(1);
                    const volTotal  = (a.cajas * a.volCaja).toFixed(3);
                    const pzsTotal  = a.cajas * a.pzsCaja;
                    return (
                      <div key={a.sku} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{a.sku}</span>
                            {sem && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${sem.badge} ${sem.text}`}>
                                {sem.dot} {sem.label}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{a.desc}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {fmt(a.cajas)} cajas · {fmt(pzsTotal)} pzs · {pesoTotal} kg · {volTotal} m³
                          </p>
                        </div>
                        <button onClick={() => quitarAncla(a.sku)} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 text-sm">✕</button>
                      </div>
                    );
                  })}
                </div>
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-500 dark:text-gray-400 flex gap-4">
                  <span>Peso total: <strong className="text-gray-700 dark:text-gray-300">{fmt(anclas.reduce((s, a) => s + a.cajas * a.pesoCaja, 0), 1)} kg</strong></span>
                  <span>Volumen total: <strong className="text-gray-700 dark:text-gray-300">{anclas.reduce((s, a) => s + a.cajas * a.volCaja, 0).toFixed(2)} m³</strong></span>
                </div>
              </div>
            )}

            {/* Catálogo del proveedor */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Catálogo ({catalogoProv.length} SKUs)</span>
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  placeholder="Buscar SKU o nombre..."
                  className="w-48 px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                    <tr className="text-gray-500 dark:text-gray-400">
                      <th className="px-4 py-2 text-left font-medium">SKU</th>
                      <th className="px-4 py-2 text-left font-medium">Descripción</th>
                      <th className="px-4 py-2 text-right font-medium">Stock</th>
                      <th className="px-4 py-2 text-right font-medium">Cobertura</th>
                      <th className="px-4 py-2 text-center font-medium">Estado</th>
                      <th className="px-4 py-2 text-right font-medium">Pzs/caja</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {catalogoFiltrado.slice(0, 100).map(s => {
                      const sem = SEM_CFG[s.semaforo];
                      const yaEsAncla = anclas.some(a => a.sku === s.sku);
                      return (
                        <tr key={s.sku}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer ${yaEsAncla ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                          onClick={() => setAnclaSkuInput(String(s.sku))}
                        >
                          <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{s.skuStr}</td>
                          <td className="px-4 py-2 text-gray-700 dark:text-gray-300 max-w-[200px] truncate">{s.desc}</td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(s.invActual)}</td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                            {s.cobDias >= 9999 ? '—' : s.cobDias > 999 ? '+999d' : `${s.cobDias.toFixed(0)}d`}
                          </td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${sem.badge} ${sem.text}`}>
                              {sem.dot}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{fmt(s.pzsCaja)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {catalogoFiltrado.length > 100 && (
                  <p className="text-center text-xs text-gray-400 py-2">Mostrando 100 de {catalogoFiltrado.length}. Usa el buscador para filtrar.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                disabled={anclas.length === 0}
                onClick={() => setStep('nmax')}
                className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
              >
                Continuar →
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 3: N_MAX ─────────────────────────────────────────────────── */}
        {step === 'nmax' && (
          <div className="max-w-md space-y-6">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Límite de contenedores</h2>
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6 space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                ¿Cuántos contenedores como máximo puede recibir la bodega en este pedido?
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { const v = Math.max(1, nMax - 1); setNMax(v); setNMaxInput(String(v)); }}
                  className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-lg transition-colors"
                >−</button>
                <input
                  type="number"
                  min={1}
                  value={nMaxInput}
                  onChange={e => {
                    setNMaxInput(e.target.value);
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v > 0) setNMax(v);
                  }}
                  className="w-24 text-center text-2xl font-bold px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => { const v = nMax + 1; setNMax(v); setNMaxInput(String(v)); }}
                  className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-lg transition-colors"
                >+</button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                N_MIN estimado (40HC): {calcularNMin(anclas, getContainerType('40HC'))} contenedor(es) con las anclas actuales
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep('anchors')} className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
                ← Atrás
              </button>
              <button onClick={irAContenedor} className="flex-1 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors">
                Evaluar contenedores →
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 4: Tipo de contenedor ──────────────────────────────────── */}
        {step === 'container' && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Tipo de contenedor</h2>

            <div className="grid gap-3">
              {ALL_CONTAINER_TYPES.map(ct => {
                const ev = evaluaciones.find(e => e.ctype.name === ct.name);
                const isRec    = ev && evaluaciones[0]?.ctype.name === ct.name;
                const isSelected = ctype.name === ct.name;
                return (
                  <button
                    key={ct.name}
                    onClick={() => setCtype(ct)}
                    className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-blue-300 dark:hover:border-blue-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-white">{ct.name}</span>
                        {isRec && <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">⭐ Recomendado</span>}
                        {isSelected && <span className="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full font-medium">Seleccionado</span>}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{fmt(ct.pesoMaxKg)} kg / {ct.volMaxM3} m³</span>
                    </div>
                    {ev ? (
                      <div className="grid grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-gray-400 dark:text-gray-500">Contenedores</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{ev.nBins}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 dark:text-gray-500">% Peso prom.</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{ev.pctPeso.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 dark:text-gray-500">% Vol prom.</p>
                          <p className="font-medium text-gray-800 dark:text-gray-200">{ev.pctVol.toFixed(1)}%</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400 dark:text-gray-500">Estado</p>
                          <p className={`font-medium text-xs ${ev.allValid ? 'text-green-600 dark:text-green-400' : ev.degraded ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'}`}>
                            {ev.allValid ? '✔ En ventana' : ev.degraded ? '⚠ Degradado' : '✖ Inválido'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No se pudo evaluar</p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep('nmax')} className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
                ← Atrás
              </button>
              <button
                onClick={resolverYMostrar}
                className="flex-1 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors"
              >
                Resolver cubicaje →
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 5: Resultado ────────────────────────────────────────────── */}
        {step === 'results' && packResult && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Resultado — {ctype.name}
            </h2>

            {/* Escenario A */}
            {packResult.excedeNMax && scenarioA && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-yellow-600 dark:text-yellow-400 font-semibold text-sm">
                    ⚠ Escenario A — Límite de contenedores excedido
                  </span>
                </div>
                <p className="text-sm text-yellow-700 dark:text-yellow-300">
                  Las anclas requieren al menos <strong>{packResult.nMin}</strong> contenedores, pero el límite es <strong>{nMax}</strong>. El modelo ajustó el pedido:
                </p>
                {scenarioA.feasible ? (
                  <>
                    <div className="space-y-1">
                      {scenarioA.recortes.map((r, i) => (
                        <div key={i} className="text-xs text-yellow-800 dark:text-yellow-200 flex gap-2">
                          <span className="font-mono">{r.sku}</span>
                          <span className="text-yellow-600 dark:text-yellow-400">{r.razon}:</span>
                          <span>{r.cajasOriginales} → <strong>{r.cajasFinales}</strong> cajas (−{r.cajasRemovidas})</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => aceptarEscenarioAYResolver(scenarioA.anclaAjustadas)}
                        className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Aceptar ajuste y continuar
                      </button>
                      <button onClick={resetPedido} className="px-4 py-2 border border-yellow-400 text-yellow-700 dark:text-yellow-300 text-sm rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors">
                        Cancelar
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-red-600 dark:text-red-400">No fue posible encontrar un recorte viable. Aumenta N_MAX o reduce las anclas.</p>
                )}
              </div>
            )}

            {/* Bins */}
            {!packResult.excedeNMax && resultBins.length > 0 && (
              <>
                {/* Score summary */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div>
                      <span className="text-gray-400 dark:text-gray-500 text-xs">Contenedores</span>
                      <p className="font-bold text-gray-900 dark:text-white">{resultBins.length} × {ctype.name}</p>
                    </div>
                    <div>
                      <span className="text-gray-400 dark:text-gray-500 text-xs">Estado global</span>
                      <p className={`font-bold ${packResult.config.valid ? 'text-green-600 dark:text-green-400' : packResult.config.degraded ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'}`}>
                        {packResult.config.valid ? '✔ En ventana' : packResult.config.degraded ? '⚠ Degradado' : '✖ Inválido'}
                      </p>
                    </div>
                    {Object.entries(packResult.scoreBreakdown).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-gray-400 dark:text-gray-500 text-xs">{k}</span>
                        <p className="font-medium text-gray-700 dark:text-gray-300 text-sm">{typeof v === 'number' ? fmt(v, 1) : v}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bins detalle */}
                <div className="space-y-3">
                  {resultBins.map((bin, i) => {
                    const stats  = getBinStats(bin);
                    const estado = binEstado(stats);
                    const cfg    = ESTADO_BIN[estado];
                    const anclaAssign = bin.assignments.filter(a => a.role === 'ancla');
                    const rellAssign  = bin.assignments.filter(a => a.role === 'relleno');
                    return (
                      <div key={i} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 dark:text-white text-sm">Contenedor {i + 1}</span>
                            <span className={`text-xs font-medium ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {stats.pesoCargado.toFixed(0)} kg · {stats.volCargado.toFixed(2)} m³
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          {/* Barras */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                <span>Peso</span><span className="font-medium">{stats.pctPeso.toFixed(1)}%</span>
                              </div>
                              <PctBar val={stats.pctPeso} low={50} high={95} />
                            </div>
                            <div>
                              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                                <span>Volumen</span><span className="font-medium">{stats.pctVol.toFixed(1)}%</span>
                              </div>
                              <PctBar val={stats.pctVol} low={75} high={90} />
                            </div>
                          </div>
                          {/* Anclas */}
                          {anclaAssign.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Anclas</p>
                              <div className="space-y-1">
                                {anclaAssign.map(a => (
                                  <div key={`${a.sku}-ancla`} className="flex items-center justify-between text-xs">
                                    <span className="text-gray-700 dark:text-gray-300 truncate mr-2">
                                      <span className="font-mono text-gray-500 dark:text-gray-400 mr-1">{a.sku}</span>
                                      {a.desc}
                                    </span>
                                    <span className="text-gray-500 dark:text-gray-400 flex-shrink-0">
                                      {fmt(a.cajas)} cajas · {fmt(a.cajas * a.pzsCaja)} pzs
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Relleno */}
                          {rellAssign.length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Relleno sugerido</p>
                              <div className="space-y-1">
                                {rellAssign.map(a => (
                                  <div key={`${a.sku}-rell`} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                                    <span className="truncate mr-2">
                                      <span className="font-mono mr-1">{a.sku}</span>{a.desc}
                                    </span>
                                    <span className="flex-shrink-0">{fmt(a.cajas)} cajas</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Top-off */}
                {topOff.length > 0 && !topOffApplied && (
                  <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">💡 Sugerencias de Top-Off</p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">Los siguientes contenedores están por debajo del piso de ventana. Se puede optimizar el llenado:</p>
                    {topOff.map((s, i) => (
                      <div key={i} className="text-xs space-y-1">
                        <p className="font-medium text-indigo-700 dark:text-indigo-300">
                          Contenedor {s.binIdx + 1}: {s.pctPesoAntes.toFixed(1)}% peso / {s.pctVolAntes.toFixed(1)}% vol
                          → {s.pctPesoDespues.toFixed(1)}% / {s.pctVolDespues.toFixed(1)}%
                        </p>
                        {s.sugerencias.map((sk, j) => (
                          <div key={j} className="flex gap-2 text-indigo-600 dark:text-indigo-400 pl-2">
                            <span className="font-mono">{sk.sku}</span>
                            <span>{sk.desc}</span>
                            <span className="font-medium">+{sk.cajas} cajas</span>
                            <span className="text-indigo-400">({sk.fuente})</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    <button
                      onClick={handleAplicarTopOff}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Aplicar sugerencias
                    </button>
                  </div>
                )}
                {topOffApplied && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl px-4 py-3">
                    <p className="text-sm text-green-700 dark:text-green-300">✔ Top-off aplicado — contenedores actualizados arriba.</p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex gap-3">
                  <button onClick={resetPedido} className="px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors">
                    + Nuevo pedido
                  </button>
                  <button onClick={() => setStep('container')} className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm">
                    ← Cambiar contenedor
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
