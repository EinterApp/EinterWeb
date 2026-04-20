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

  const BackBtn = ({ onClick, label = 'Atrás' }: { onClick: () => void; label?: string }) => (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/80 hover:border-gray-300 dark:hover:border-gray-600 transition-all text-sm font-medium"
    >
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 4L6 8l4 4"/></svg>
      {label}
    </button>
  );

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center gap-6">
        {loading && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100 dark:border-blue-900/40" />
              <div className="absolute inset-0 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Cargando catálogo</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Sincronizando productos de Odoo…</p>
            </div>
          </div>
        )}
        {error && (
          <div className="max-w-sm text-center bg-white dark:bg-gray-900 border border-red-100 dark:border-red-900/40 rounded-2xl p-6 shadow-sm">
            <div className="w-10 h-10 bg-red-50 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">{error}</p>
            <button onClick={cargarCatalogo} className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors">
              Reintentar
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-20">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 px-6 py-3 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 dark:text-white leading-none">Pedido Personalizado</h1>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Motor de cubicaje v1.2</p>
            </div>
          </div>

          {/* Stepper */}
          <div className="hidden sm:flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <div className={`flex items-center gap-1.5 text-xs font-medium transition-all ${
                  i < stepIdx  ? 'text-blue-500 dark:text-blue-400'
                  : i === stepIdx ? 'text-blue-600 dark:text-blue-300'
                  : 'text-gray-400 dark:text-gray-600'
                }`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 transition-all ${
                    i < stepIdx  ? 'bg-blue-500 text-white'
                    : i === stepIdx ? 'bg-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-blue-900/50'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600'
                  }`}>
                    {i < stepIdx ? (
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M2 5l2.5 2.5L8 3"/></svg>
                    ) : i + 1}
                  </div>
                  <span className="hidden md:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-5 h-px mx-0.5 transition-all ${i < stepIdx ? 'bg-blue-300 dark:bg-blue-700' : 'bg-gray-200 dark:bg-gray-700'}`} />
                )}
              </div>
            ))}
          </div>

          {step !== 'supplier' && (
            <button
              onClick={resetPedido}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-500 dark:hover:border-red-800 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-all"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2 6h8M2 6l3-3M2 6l3 3"/></svg>
              Nuevo pedido
            </button>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-7">

        {/* ── PASO 1: Proveedor ──────────────────────────────────────────────── */}
        {step === 'supplier' && (
          <div>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Selecciona un proveedor</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{supplierStats.length} proveedores disponibles</p>
            </div>
            <div className="grid gap-2.5">
              {supplierStats.map(s => {
                const total = s.critico + s.alerta + s.ok + s.sobrestock || 1;
                return (
                  <button
                    key={s.supplier}
                    onClick={() => { setSupplier(s.supplier); setAnclas([]); setStep('anchors'); }}
                    className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl px-5 py-4 text-left hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                            {s.supplier}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{s.total} SKUs</span>
                        </div>
                        {/* mini progress bar */}
                        <div className="flex h-1.5 mt-2 rounded-full overflow-hidden gap-px w-full max-w-[200px]">
                          {s.critico    > 0 && <div className="bg-red-400"    style={{ width: `${(s.critico/total)*100}%` }} />}
                          {s.alerta     > 0 && <div className="bg-yellow-400" style={{ width: `${(s.alerta/total)*100}%` }} />}
                          {s.ok         > 0 && <div className="bg-green-400"  style={{ width: `${(s.ok/total)*100}%` }} />}
                          {s.sobrestock > 0 && <div className="bg-blue-300"   style={{ width: `${(s.sobrestock/total)*100}%` }} />}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 text-xs flex-shrink-0">
                        {s.critico    > 0 && <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>{s.critico}</span>}
                        {s.alerta     > 0 && <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 font-medium"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"/>{s.alerta}</span>}
                        {s.ok         > 0 && <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium"><span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>{s.ok}</span>}
                        {s.sobrestock > 0 && <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400 font-medium"><span className="w-2 h-2 rounded-full bg-blue-300 inline-block"/>{s.sobrestock}</span>}
                        <svg className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M6 4l4 4-4 4"/></svg>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PASO 2: Anclas ────────────────────────────────────────────────── */}
        {step === 'anchors' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{supplier}</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Agrega los productos ancla del pedido</p>
              </div>
              <BackBtn onClick={() => setStep('supplier')} label="Cambiar proveedor" />
            </div>

            {/* Form agregar ancla */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">Agregar ancla</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">SKU</label>
                  <input
                    type="number"
                    value={anclaSkuInput}
                    onChange={e => setAnclaSkuInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && agregarAncla()}
                    placeholder="Ej. 1234"
                    className="w-32 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Cantidad</label>
                  <input
                    type="number"
                    value={anclaQtyInput}
                    onChange={e => setAnclaQtyInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && agregarAncla()}
                    placeholder="Ej. 5000"
                    className="w-32 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Unidad</label>
                  <select
                    value={anclaUnidad}
                    onChange={e => setAnclaUnidad(e.target.value as 'piezas' | 'cajas')}
                    className="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  >
                    <option value="piezas">Piezas</option>
                    <option value="cajas">Cajas</option>
                  </select>
                </div>
                <button
                  onClick={agregarAncla}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm shadow-blue-200 dark:shadow-none"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
                  Agregar
                </button>
              </div>
              {anclaError && (
                <div className="mt-3 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="6"/><path strokeLinecap="round" d="M8 5v4m0 2.5v.5"/></svg>
                  {anclaError}
                </div>
              )}
            </div>

            {/* Anclas del pedido */}
            {anclas.length > 0 && (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Anclas del pedido</span>
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">{anclas.length}</span>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-800">
                  {anclas.map(a => {
                    const row = catalogoProv.find(s => s.sku === a.sku);
                    const sem = row ? SEM_CFG[row.semaforo] : null;
                    const pzsTotal = a.cajas * a.pzsCaja;
                    return (
                      <div key={a.sku} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-semibold text-gray-800 dark:text-gray-200">{a.sku}</span>
                            {sem && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${sem.badge} ${sem.text}`}>
                                {sem.dot} {sem.label}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{a.desc}</p>
                          <div className="flex gap-3 text-xs text-gray-400 dark:text-gray-500 mt-1">
                            <span>{fmt(a.cajas)} cajas</span>
                            <span>{fmt(pzsTotal)} pzs</span>
                            <span>{(a.cajas * a.pesoCaja).toFixed(1)} kg</span>
                            <span>{(a.cajas * a.volCaja).toFixed(3)} m³</span>
                          </div>
                        </div>
                        <button
                          onClick={() => quitarAncla(a.sku)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-300 dark:text-gray-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-400 transition-all flex-shrink-0"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M2 2l10 10M12 2L2 12"/></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/40 flex gap-5 text-xs">
                  <span className="text-gray-500 dark:text-gray-400">Peso: <strong className="text-gray-700 dark:text-gray-200">{fmt(anclas.reduce((s, a) => s + a.cajas * a.pesoCaja, 0), 1)} kg</strong></span>
                  <span className="text-gray-500 dark:text-gray-400">Volumen: <strong className="text-gray-700 dark:text-gray-200">{anclas.reduce((s, a) => s + a.cajas * a.volCaja, 0).toFixed(2)} m³</strong></span>
                </div>
              </div>
            )}

            {/* Catálogo */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Catálogo <span className="normal-case font-medium text-gray-400">({catalogoProv.length} SKUs)</span>
                </span>
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><circle cx="6.5" cy="6.5" r="4"/><path strokeLinecap="round" d="M11 11l3 3"/></svg>
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={e => setCatalogSearch(e.target.value)}
                    placeholder="Buscar…"
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
                  />
                </div>
              </div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 z-10">
                    <tr className="text-gray-400 dark:text-gray-500">
                      <th className="px-5 py-2.5 text-left font-medium">SKU</th>
                      <th className="px-4 py-2.5 text-left font-medium">Descripción</th>
                      <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                      <th className="px-4 py-2.5 text-right font-medium">Cobertura</th>
                      <th className="px-4 py-2.5 text-center font-medium">Estado</th>
                      <th className="px-5 py-2.5 text-right font-medium">Pzs/caja</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {catalogoFiltrado.slice(0, 100).map(s => {
                      const sem = SEM_CFG[s.semaforo];
                      const yaEsAncla = anclas.some(a => a.sku === s.sku);
                      return (
                        <tr
                          key={s.sku}
                          className={`cursor-pointer transition-colors ${yaEsAncla ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
                          onClick={() => setAnclaSkuInput(String(s.sku))}
                        >
                          <td className="px-5 py-2.5 font-mono text-gray-700 dark:text-gray-300">
                            {yaEsAncla && <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 mb-0.5" />}
                            {s.skuStr}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 max-w-[180px] truncate">{s.desc}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">{fmt(s.invActual)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                            {s.cobDias >= 9999 ? '—' : s.cobDias > 999 ? '+999d' : `${s.cobDias.toFixed(0)}d`}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-block px-1.5 py-0.5 rounded-full text-xs font-medium ${sem.badge} ${sem.text}`}>
                              {sem.dot}
                            </span>
                          </td>
                          <td className="px-5 py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">{fmt(s.pzsCaja)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {catalogoFiltrado.length > 100 && (
                  <p className="text-center text-xs text-gray-400 dark:text-gray-600 py-3 border-t border-gray-50 dark:border-gray-800">
                    Mostrando 100 de {catalogoFiltrado.length} — filtra para ver más
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                disabled={anclas.length === 0}
                onClick={() => setStep('nmax')}
                className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-none text-sm"
              >
                Continuar
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4l4 4-4 4"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 3: N_MAX ─────────────────────────────────────────────────── */}
        {step === 'nmax' && (
          <div className="max-w-sm space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Límite de contenedores</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">¿Cuántos puede recibir la bodega en este pedido?</p>
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => { const v = Math.max(1, nMax - 1); setNMax(v); setNMaxInput(String(v)); }}
                  className="w-11 h-11 rounded-full border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xl transition-all flex items-center justify-center"
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
                  className="w-24 text-center text-3xl font-bold px-3 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                <button
                  onClick={() => { const v = nMax + 1; setNMax(v); setNMaxInput(String(v)); }}
                  className="w-11 h-11 rounded-full border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold text-xl transition-all flex items-center justify-center"
                >+</button>
              </div>
              <p className="text-xs text-center text-gray-400 dark:text-gray-500 mt-4">
                N_MIN estimado (40HC): <span className="font-semibold text-gray-600 dark:text-gray-300">{calcularNMin(anclas, getContainerType('40HC'))}</span> contenedor(es)
              </p>
            </div>

            <div className="flex gap-3">
              <BackBtn onClick={() => setStep('anchors')} />
              <button
                onClick={irAContenedor}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-none text-sm"
              >
                Evaluar contenedores
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4l4 4-4 4"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 4: Tipo de contenedor ──────────────────────────────────── */}
        {step === 'container' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Tipo de contenedor</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Selecciona el tipo óptimo para tu pedido</p>
            </div>

            <div className="grid gap-3">
              {ALL_CONTAINER_TYPES.map(ct => {
                const ev = evaluaciones.find(e => e.ctype.name === ct.name);
                const isRec      = ev && evaluaciones[0]?.ctype.name === ct.name;
                const isSelected = ctype.name === ct.name;
                const statusColor = ev
                  ? ev.allValid ? 'text-green-600 dark:text-green-400'
                  : ev.degraded ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-red-500 dark:text-red-400'
                  : 'text-gray-400';
                return (
                  <button
                    key={ct.name}
                    onClick={() => setCtype(ct)}
                    className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 shadow-sm'
                        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-blue-200 dark:hover:border-blue-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold text-base ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{ct.name}</span>
                        {isRec && <span className="text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full font-medium">Recomendado</span>}
                        {isSelected && <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">Seleccionado</span>}
                      </div>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 mt-0.5">{fmt(ct.pesoMaxKg)} kg · {ct.volMaxM3} m³</span>
                    </div>
                    {ev ? (
                      <div className="grid grid-cols-4 gap-2">
                        {[
                          { label: 'Contenedores', value: String(ev.nBins) },
                          { label: '% Peso',       value: `${ev.pctPeso.toFixed(1)}%` },
                          { label: '% Volumen',    value: `${ev.pctVol.toFixed(1)}%` },
                          { label: 'Estado',       value: ev.allValid ? 'En ventana' : ev.degraded ? 'Degradado' : 'Inválido', cls: statusColor },
                        ].map(col => (
                          <div key={col.label} className="bg-white/60 dark:bg-gray-800/40 rounded-lg p-2">
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-0.5">{col.label}</p>
                            <p className={`text-sm font-semibold ${col.cls ?? 'text-gray-800 dark:text-gray-200'}`}>{col.value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">No se pudo evaluar</p>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <BackBtn onClick={() => setStep('nmax')} />
              <button
                onClick={resolverYMostrar}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-none text-sm"
              >
                Resolver cubicaje
                <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 4l4 4-4 4"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── PASO 5: Resultado ────────────────────────────────────────────── */}
        {step === 'results' && packResult && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Resultado del cubicaje</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Contenedor {ctype.name} · {supplier}</p>
            </div>

            {/* Escenario A */}
            {packResult.excedeNMax && scenarioA && (
              <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M8 3l6.5 11H1.5L8 3zm0 4v3m0 2.5v.5"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Límite de contenedores excedido</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      Las anclas requieren <strong>{packResult.nMin}</strong> contenedores, el límite es <strong>{nMax}</strong>. El modelo propone un ajuste:
                    </p>
                  </div>
                </div>
                {scenarioA.feasible ? (
                  <>
                    <div className="bg-white/60 dark:bg-gray-800/40 rounded-lg divide-y divide-amber-100 dark:divide-amber-900/30">
                      {scenarioA.recortes.map((r, i) => (
                        <div key={i} className="px-3 py-2.5 flex gap-3 text-xs">
                          <span className="font-mono font-semibold text-amber-800 dark:text-amber-300 w-12 flex-shrink-0">{r.sku}</span>
                          <span className="text-amber-600 dark:text-amber-400 flex-shrink-0">{r.razon}</span>
                          <span className="text-amber-700 dark:text-amber-300">{r.cajasOriginales} → <strong>{r.cajasFinales}</strong> cajas (−{r.cajasRemovidas})</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => aceptarEscenarioAYResolver(scenarioA.anclaAjustadas)}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors"
                      >
                        Aceptar y continuar
                      </button>
                      <button onClick={resetPedido} className="px-4 py-2 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 text-sm rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors">
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
                {/* Resumen global */}
                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5">
                  <div className="flex flex-wrap gap-x-8 gap-y-3">
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Contenedores</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white leading-none">{resultBins.length} <span className="text-sm font-medium text-gray-500">× {ctype.name}</span></p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Estado global</p>
                      <p className={`text-sm font-bold ${packResult.config.valid ? 'text-green-600 dark:text-green-400' : packResult.config.degraded ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'}`}>
                        {packResult.config.valid ? '✔ En ventana' : packResult.config.degraded ? '⚠ Degradado' : '✖ Inválido'}
                      </p>
                    </div>
                    {Object.entries(packResult.scoreBreakdown).map(([k, v]) => (
                      <div key={k}>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">{k}</p>
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{typeof v === 'number' ? fmt(v, 1) : v}</p>
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
                    const borderCls = estado === 'optimal' ? 'border-blue-200 dark:border-blue-800'
                      : estado === 'valid' ? 'border-green-200 dark:border-green-900'
                      : estado === 'degraded' ? 'border-yellow-200 dark:border-yellow-800'
                      : 'border-red-200 dark:border-red-900';
                    return (
                      <div key={i} className={`bg-white dark:bg-gray-900 border rounded-xl overflow-hidden ${borderCls}`}>
                        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span className="font-bold text-gray-900 dark:text-white text-sm">Contenedor {i + 1}</span>
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800 ${cfg.color}`}>{cfg.icon} {cfg.label}</span>
                          </div>
                          <div className="text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                            {stats.pesoCargado.toFixed(0)} kg · {stats.volCargado.toFixed(2)} m³
                          </div>
                        </div>
                        <div className="p-5 space-y-4">
                          {/* Barras */}
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-gray-400 dark:text-gray-500">Peso</span>
                                <span className="font-semibold text-gray-700 dark:text-gray-300">{stats.pctPeso.toFixed(1)}%</span>
                              </div>
                              <PctBar val={stats.pctPeso} low={50} high={95} />
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-gray-400 dark:text-gray-500">Volumen</span>
                                <span className="font-semibold text-gray-700 dark:text-gray-300">{stats.pctVol.toFixed(1)}%</span>
                              </div>
                              <PctBar val={stats.pctVol} low={75} high={90} />
                            </div>
                          </div>

                          {/* Anclas */}
                          {anclaAssign.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Anclas</p>
                              <div className="space-y-1.5">
                                {anclaAssign.map(a => (
                                  <div key={`${a.sku}-ancla`} className="flex items-center justify-between text-xs gap-2">
                                    <span className="text-gray-700 dark:text-gray-300 truncate">
                                      <span className="font-mono text-gray-400 dark:text-gray-500 mr-1.5">{a.sku}</span>
                                      {a.desc}
                                    </span>
                                    <span className="text-gray-500 dark:text-gray-400 flex-shrink-0 tabular-nums">
                                      {fmt(a.cajas)} cj · {fmt(a.cajas * a.pzsCaja)} pzs
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Relleno */}
                          {rellAssign.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Relleno sugerido</p>
                              <div className="space-y-1.5">
                                {rellAssign.map(a => (
                                  <div key={`${a.sku}-rell`} className="flex items-center justify-between text-xs gap-2">
                                    <span className="text-gray-500 dark:text-gray-400 truncate">
                                      <span className="font-mono mr-1.5">{a.sku}</span>{a.desc}
                                    </span>
                                    <span className="text-gray-400 dark:text-gray-500 flex-shrink-0 tabular-nums">{fmt(a.cajas)} cj</span>
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
                  <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-200 dark:border-indigo-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3"/></svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-indigo-800 dark:text-indigo-300">Sugerencias de Top-Off</p>
                        <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">Contenedores por debajo del piso de ventana — se puede optimizar el llenado</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {topOff.map((s, i) => (
                        <div key={i} className="bg-white/60 dark:bg-gray-800/30 rounded-lg p-3 space-y-2">
                          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                            Contenedor {s.binIdx + 1}:
                            <span className="font-normal ml-1">{s.pctPesoAntes.toFixed(1)}%p/{s.pctVolAntes.toFixed(1)}%v → {s.pctPesoDespues.toFixed(1)}%/{s.pctVolDespues.toFixed(1)}%</span>
                          </p>
                          {s.sugerencias.map((sk, j) => (
                            <div key={j} className="flex gap-2 text-xs text-indigo-600 dark:text-indigo-400 pl-2">
                              <span className="font-mono font-medium">{sk.sku}</span>
                              <span className="truncate">{sk.desc}</span>
                              <span className="font-semibold flex-shrink-0">+{sk.cajas} cj</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={handleAplicarTopOff}
                      className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M2 7l4 4 6-6"/></svg>
                      Aplicar sugerencias
                    </button>
                  </div>
                )}
                {topOffApplied && (
                  <div className="flex items-center gap-3 bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-xl px-5 py-4">
                    <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" d="M5 10l4 4 6-6"/></svg>
                    <p className="text-sm text-green-700 dark:text-green-300">Top-off aplicado — contenedores actualizados.</p>
                  </div>
                )}

                {/* Acciones */}
                <div className="flex gap-3 pt-1">
                  <BackBtn onClick={() => setStep('container')} label="Cambiar contenedor" />
                  <button
                    onClick={resetPedido}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-xl transition-colors shadow-sm shadow-blue-200 dark:shadow-none text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>
                    Nuevo pedido
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
