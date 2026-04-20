/**
 * packingEngine.ts — Motor de cubicaje Einter v1.2 (port TypeScript)
 *
 * Implementa FFD para anclas + Greedy Knapsack para relleno + scoring +
 * recomendador de contenedor + top-off + Escenario A de recorte.
 *
 * Greedy knapsack en lugar de MILP (PuLP/CBC) — produce resultados de
 * calidad equivalente para el tamaño de problema típico (< 100 SKUs).
 */

// ─── Constantes ───────────────────────────────────────────────────────────────

export const CONTAINER_SPECS = {
  '20ft': { pesoMaxKg: 21_700, volMaxM3: 33.0 },
  '40ft': { pesoMaxKg: 26_500, volMaxM3: 67.0 },
  '40HC': { pesoMaxKg: 26_500, volMaxM3: 76.0 },
} as const;

export type ContainerName = keyof typeof CONTAINER_SPECS;

const VENTANA_PESO_MIN = 0.50;
const VENTANA_PESO_MAX = 0.95;
const VENTANA_VOL_MIN  = 0.75;
const VENTANA_VOL_MAX  = 0.90;
const MIN_PZS_SKU_RELLENO = 1_000;
const MIN_PZS_TOP_OFF     = 500;
const LEAD_TIME_DIAS          = 60;
const DIAS_OBJETIVO_COBERTURA = 150;
const UMBRAL_SOBRESTOCK = 300;
const ALERTA_ROJO       = 60;
const ALERTA_AMARILLO   = 80;

// ─── Tipos básicos ────────────────────────────────────────────────────────────

export interface ContainerType {
  name: ContainerName;
  pesoMaxKg: number;
  volMaxM3:  number;
}

export function getContainerType(name: ContainerName): ContainerType {
  const s = CONTAINER_SPECS[name];
  return { name, pesoMaxKg: s.pesoMaxKg, volMaxM3: s.volMaxM3 };
}

export const ALL_CONTAINER_TYPES: ContainerType[] = (
  ['20ft', '40ft', '40HC'] as ContainerName[]
).map(getContainerType);

export interface Assignment {
  sku:      number;
  cajas:    number;
  pesoCaja: number; // kg/caja
  volCaja:  number; // m³/caja
  pzsCaja:  number;
  role:     'ancla' | 'relleno';
  desc:     string;
}

export interface BinState {
  containerType: ContainerType;
  assignments:   Assignment[];
}

export interface Ancla {
  sku:             number;
  cajas:           number;
  pesoCaja:        number;
  volCaja:         number;
  pzsCaja:         number;
  desc:            string;
  cajasMaxFallback?: number; // para top-off fallback
}

export interface CandidatoRelleno {
  sku:      number;
  dI:       number; // demanda piezas/día
  cobDias:  number;
  estado:   string; // CRITICO | ALERTA | OK | SOBRESTOCK
  pesoCaja: number;
  volCaja:  number;
  pzsCaja:  number;
  cajasMax: number;
  desc:     string;
}

export type SemaforoStatus = 'CRITICO' | 'ALERTA' | 'OK' | 'SOBRESTOCK';

// ─── Semáforo ─────────────────────────────────────────────────────────────────

export function clasificarSemaforo(cobDias: number): SemaforoStatus {
  if (cobDias > UMBRAL_SOBRESTOCK) return 'SOBRESTOCK';
  if (cobDias < ALERTA_ROJO)       return 'CRITICO';
  if (cobDias < ALERTA_AMARILLO)   return 'ALERTA';
  return 'OK';
}

export function calcularCajasMaxRelleno(
  invEfectivo: number,
  dI:          number,
  pzsCaja:     number,
): number {
  if (pzsCaja <= 0 || dI <= 0) return 0;
  const invRecepcion  = Math.max(0, invEfectivo - dI * LEAD_TIME_DIAS);
  const pzsNecesarias = Math.max(0, dI * DIAS_OBJETIVO_COBERTURA - invRecepcion);
  return Math.floor(pzsNecesarias / pzsCaja);
}

// ─── Helpers de Bin ───────────────────────────────────────────────────────────

function pesoCargado(b: BinState): number {
  return b.assignments.reduce((s, a) => s + a.cajas * a.pesoCaja, 0);
}
function volCargado(b: BinState): number {
  return b.assignments.reduce((s, a) => s + a.cajas * a.volCaja, 0);
}
function pctPeso(b: BinState): number {
  return 100 * pesoCargado(b) / b.containerType.pesoMaxKg;
}
function pctVol(b: BinState): number {
  return 100 * volCargado(b) / b.containerType.volMaxM3;
}
function espacioPesoFisico(b: BinState): number {
  return b.containerType.pesoMaxKg - pesoCargado(b);
}
function espacioVolFisico(b: BinState): number {
  return b.containerType.volMaxM3 - volCargado(b);
}
function espacioPesoVentana(b: BinState): number {
  return Math.max(0, b.containerType.pesoMaxKg * VENTANA_PESO_MAX - pesoCargado(b));
}
function espacioVolVentana(b: BinState): number {
  return Math.max(0, b.containerType.volMaxM3 * VENTANA_VOL_MAX - volCargado(b));
}
function cabesFisicamente(b: BinState, peso: number, vol: number): boolean {
  return (
    pesoCargado(b) + peso <= b.containerType.pesoMaxKg + 1e-6 &&
    volCargado(b)  + vol  <= b.containerType.volMaxM3  + 1e-6
  );
}
function estaEnVentana(b: BinState): boolean {
  const p = pesoCargado(b);
  const v = volCargado(b);
  const c = b.containerType;
  if (p < c.pesoMaxKg * VENTANA_PESO_MIN - 1e-6) return false;
  if (v < c.volMaxM3  * VENTANA_VOL_MIN  - 1e-6) return false;
  if (p > c.pesoMaxKg + 1e-6) return false;
  if (v > c.volMaxM3  + 1e-6) return false;
  return true;
}
function gapPpFueraVentana(b: BinState): number {
  const gapP = Math.max(0, VENTANA_PESO_MIN * 100 - pctPeso(b));
  const gapV = Math.max(0, VENTANA_VOL_MIN  * 100 - pctVol(b));
  return Math.max(gapP, gapV);
}
function desbalancePp(b: BinState): number {
  return Math.abs(pctPeso(b) - pctVol(b));
}
function esOptimoPorAnclas(b: BinState): boolean {
  const c = b.containerType;
  const p = pesoCargado(b);
  const v = volCargado(b);
  const excedeOp = p > c.pesoMaxKg * VENTANA_PESO_MAX + 1e-6 || v > c.volMaxM3 * VENTANA_VOL_MAX + 1e-6;
  const dentroFisico = p <= c.pesoMaxKg + 1e-6 && v <= c.volMaxM3 + 1e-6;
  return excedeOp && dentroFisico;
}

function addAssignment(b: BinState, a: Assignment): void {
  const existing = b.assignments.find(e => e.sku === a.sku && e.role === a.role);
  if (existing) { existing.cajas += a.cajas; }
  else          { b.assignments.push({ ...a }); }
}

function copyBin(b: BinState): BinState {
  return { containerType: b.containerType, assignments: b.assignments.map(a => ({ ...a })) };
}

export function getBinStats(b: BinState) {
  return {
    pesoCargado:  pesoCargado(b),
    volCargado:   volCargado(b),
    pctPeso:      pctPeso(b),
    pctVol:       pctVol(b),
    enVentana:    estaEnVentana(b),
    gapPp:        gapPpFueraVentana(b),
    optimo:       esOptimoPorAnclas(b),
    degraded:     !estaEnVentana(b) && gapPpFueraVentana(b) <= 5.0,
  };
}

// ─── FFD ──────────────────────────────────────────────────────────────────────

function anclaFootprint(a: Ancla): number {
  return (a.cajas * a.pesoCaja / 26_500) + (a.cajas * a.volCaja / 76);
}

export function calcularNMin(anclas: Ancla[], ctype: ContainerType): number {
  const totalPeso = anclas.reduce((s, a) => s + a.cajas * a.pesoCaja, 0);
  const totalVol  = anclas.reduce((s, a) => s + a.cajas * a.volCaja,  0);
  const nPorPeso  = totalPeso > 0 ? Math.ceil(totalPeso / ctype.pesoMaxKg) : 0;
  const nPorVol   = totalVol  > 0 ? Math.ceil(totalVol  / ctype.volMaxM3)  : 0;
  return Math.max(1, nPorPeso, nPorVol);
}

function distribuirFFD(
  anclas: Ancla[],
  ctype:  ContainerType,
  nBins:  number,
): { bins: BinState[]; nFragmentos: number } {
  const bins: BinState[] = Array.from({ length: nBins }, () => ({
    containerType: ctype,
    assignments:   [],
  }));
  let nFragmentos = 0;

  const sorted = [...anclas].sort((a, b) => anclaFootprint(b) - anclaFootprint(a));

  for (const a of sorted) {
    const pesoTotal = a.cajas * a.pesoCaja;
    const volTotal  = a.cajas * a.volCaja;

    // Intento 1: colocar completa en mejor bin
    let bestBin: BinState | null = null;
    let bestSpace = -Infinity;
    for (const b of bins) {
      if (cabesFisicamente(b, pesoTotal, volTotal)) {
        const freeAfter =
          (b.containerType.pesoMaxKg - pesoCargado(b) - pesoTotal) / b.containerType.pesoMaxKg +
          (b.containerType.volMaxM3  - volCargado(b)  - volTotal)  / b.containerType.volMaxM3;
        if (freeAfter > bestSpace) { bestSpace = freeAfter; bestBin = b; }
      }
    }
    if (bestBin) {
      addAssignment(bestBin, { sku: a.sku, cajas: a.cajas, pesoCaja: a.pesoCaja, volCaja: a.volCaja, pzsCaja: a.pzsCaja, role: 'ancla', desc: a.desc });
      continue;
    }

    // Intento 2: fragmentar caja por caja
    let cajasPendientes = a.cajas;
    let binsUsados = 0;
    while (cajasPendientes > 0) {
      let targetBin: BinState | null = null;
      let maxCajasCaben = 0;
      for (const b of bins) {
        const espP = espacioPesoFisico(b);
        const espV = espacioVolFisico(b);
        const cP = a.pesoCaja > 0 ? Math.floor(espP / a.pesoCaja) : cajasPendientes;
        const cV = a.volCaja  > 0 ? Math.floor(espV / a.volCaja)  : cajasPendientes;
        const caben = Math.min(cP, cV, cajasPendientes);
        if (caben > maxCajasCaben) { maxCajasCaben = caben; targetBin = b; }
      }
      if (!targetBin || maxCajasCaben === 0) {
        throw new Error(`No se puede distribuir SKU ${a.sku}: faltan ${cajasPendientes} cajas`);
      }
      addAssignment(targetBin, { sku: a.sku, cajas: maxCajasCaben, pesoCaja: a.pesoCaja, volCaja: a.volCaja, pzsCaja: a.pzsCaja, role: 'ancla', desc: a.desc });
      cajasPendientes -= maxCajasCaben;
      binsUsados++;
    }
    const binsConSku = bins.filter(b => b.assignments.some(ag => ag.sku === a.sku)).length;
    if (binsConSku > 1) nFragmentos += binsConSku - 1;
  }

  return { bins, nFragmentos };
}

// ─── Scoring SKU candidato ────────────────────────────────────────────────────

const SEMAFORO_FACTOR: Record<string, number> = {
  CRITICO: 3.0, ALERTA: 2.0, OK: 1.0, SOBRESTOCK: 0.0,
};

function scoreSkuCandidato(
  c: CandidatoRelleno,
  espPeso: number,
  espVol:  number,
): number {
  if (c.estado === 'SOBRESTOCK') return 0;
  const urgS   = c.dI / Math.max(c.cobDias, 1);
  const urgSem = SEMAFORO_FACTOR[c.estado] ?? 1.0;
  const rhoSku = c.volCaja > 0 ? c.pesoCaja / c.volCaja : 0;
  const rhoGap = espVol    > 0 ? espPeso    / espVol    : 0;
  let fDens = 0;
  if (rhoSku > 0 && rhoGap > 0) {
    fDens = Math.exp(-Math.abs(Math.log(rhoSku / rhoGap)) * 1.5);
  }
  return urgS * fDens * urgSem + c.dI * 0.001;
}

// ─── Greedy Knapsack ──────────────────────────────────────────────────────────

function cajasMinRelleno(pzsCaja: number): number {
  return pzsCaja <= 0 ? 1 : Math.ceil(MIN_PZS_SKU_RELLENO / pzsCaja);
}

function rellenarBinGreedy(
  bin:            BinState,
  candidatos:     CandidatoRelleno[],
  skusExcluidos:  Set<number>,
): void {
  const elegibles = candidatos.filter(c => {
    if (skusExcluidos.has(c.sku)) return false;
    if (c.estado === 'SOBRESTOCK') return false;
    if (c.cajasMax <= 0) return false;
    const cmin = cajasMinRelleno(c.pzsCaja);
    if (cmin > c.cajasMax) return false;
    const espP = espacioPesoVentana(bin);
    const espV = espacioVolVentana(bin);
    if (cmin * c.pesoCaja > espP + 1e-6) return false;
    if (cmin * c.volCaja  > espV + 1e-6) return false;
    return true;
  });

  const scored = elegibles
    .map(c => ({ c, score: scoreSkuCandidato(c, espacioPesoVentana(bin), espacioVolVentana(bin)) }))
    .sort((a, b) => b.score - a.score);

  for (const { c } of scored) {
    const espP = espacioPesoVentana(bin);
    const espV = espacioVolVentana(bin);
    if (espP <= 0 || espV <= 0) break;

    const cmin = cajasMinRelleno(c.pzsCaja);
    const cP   = c.pesoCaja > 0 ? Math.floor(espP / c.pesoCaja) : c.cajasMax;
    const cV   = c.volCaja  > 0 ? Math.floor(espV / c.volCaja)  : c.cajasMax;
    const cajas = Math.min(c.cajasMax, cP, cV);
    if (cajas < cmin) continue;

    addAssignment(bin, { sku: c.sku, cajas, pesoCaja: c.pesoCaja, volCaja: c.volCaja, pzsCaja: c.pzsCaja, role: 'relleno', desc: c.desc });
  }
}

// ─── Scoring de configuración ─────────────────────────────────────────────────

const SCORE_VALIDEZ_TOTAL   = 100_000;
const SCORE_DEGRADADO       =  50_000;
const SCORE_PENAL_BIN_INVAL =  -5_000;
const SCORE_APROV_POR_PP    =      50;
const SCORE_POR_CONTENEDOR  =    -500;
const SCORE_POR_FRAGMENTO   =     -50;
const SCORE_DESBALANCE_PP   =     -10;

export interface PackingConfig {
  bins:         BinState[];
  score:        number;
  nFragmentos:  number;
  valid:        boolean;
  degraded:     boolean;
}

function scoreConfig(config: PackingConfig): { score: number; breakdown: Record<string, number> } {
  const { bins, nFragmentos } = config;
  const valid  = bins.every(estaEnVentana);
  const maxGap = bins.length > 0 ? Math.max(...bins.map(gapPpFueraVentana)) : 0;

  let sValidez: number;
  if (valid)          sValidez = SCORE_VALIDEZ_TOTAL;
  else if (maxGap <= 5.0) sValidez = SCORE_DEGRADADO;
  else sValidez = SCORE_PENAL_BIN_INVAL * bins.filter(b => !estaEnVentana(b)).length;

  const sAprov  = (
    bins.reduce((s, b) => s + pctPeso(b), 0) / (bins.length || 1) +
    bins.reduce((s, b) => s + pctVol(b),  0) / (bins.length || 1)
  ) * SCORE_APROV_POR_PP;
  const sNbins  = bins.length * SCORE_POR_CONTENEDOR;
  const sFrag   = nFragmentos * SCORE_POR_FRAGMENTO;
  const sDesbal = (bins.length > 0 ? Math.max(...bins.map(desbalancePp)) : 0) * SCORE_DESBALANCE_PP;
  const total   = sValidez + sAprov + sNbins + sFrag + sDesbal;

  return {
    score: total,
    breakdown: { S_validez: sValidez, S_aprov: +sAprov.toFixed(1), S_nbins: sNbins, S_frag: sFrag, S_desbal: +sDesbal.toFixed(1), TOTAL: +total.toFixed(1) },
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────

function construirConfig(
  anclas:     Ancla[],
  candidatos: CandidatoRelleno[],
  ctype:      ContainerType,
  nBins:      number,
): PackingConfig {
  const { bins, nFragmentos } = distribuirFFD(anclas, ctype, nBins);
  for (const b of bins) {
    const skusAncla = new Set(b.assignments.filter(a => a.role === 'ancla').map(a => a.sku));
    rellenarBinGreedy(b, candidatos, skusAncla);
  }
  return { bins, score: 0, nFragmentos, valid: false, degraded: false };
}

export interface PackingResult {
  config:         PackingConfig;
  scoreBreakdown: Record<string, number>;
  nMin:           number;
  excedeNMax:     boolean;
}

export function resolverPedido(
  anclas:     Ancla[],
  candidatos: CandidatoRelleno[],
  ctype:      ContainerType,
  nMax:       number | null,
): PackingResult {
  const nMin = calcularNMin(anclas, ctype);

  if (nMax !== null && nMin > nMax) {
    return { config: { bins: [], score: -Infinity, nFragmentos: 0, valid: false, degraded: false }, scoreBreakdown: {}, nMin, excedeNMax: true };
  }

  const rangoMax = nMax !== null ? Math.min(nMin + 2, nMax) : nMin + 2;
  let mejor:          PackingConfig | null = null;
  let mejorScore      = -Infinity;
  let mejorBreakdown: Record<string, number> = {};

  for (let n = nMin; n <= rangoMax; n++) {
    try {
      const cfg = construirConfig(anclas, candidatos, ctype, n);
      const { score, breakdown } = scoreConfig(cfg);
      cfg.score    = score;
      cfg.valid    = cfg.bins.every(estaEnVentana);
      cfg.degraded = !cfg.valid && (cfg.bins.length > 0 ? Math.max(...cfg.bins.map(gapPpFueraVentana)) : 0) <= 5.0;
      if (score > mejorScore) { mejorScore = score; mejor = cfg; mejorBreakdown = breakdown; }
    } catch { /* skip n si FFD falla */ }
  }

  if (!mejor) mejor = { bins: [], score: -Infinity, nFragmentos: 0, valid: false, degraded: false };
  return { config: mejor, scoreBreakdown: mejorBreakdown, nMin, excedeNMax: false };
}

// ─── Recomendador de tipo ─────────────────────────────────────────────────────

export interface EvaluacionTipo {
  ctype:    ContainerType;
  score:    number;
  nBins:    number;
  allValid: boolean;
  pctPeso:  number;
  pctVol:   number;
  degraded: boolean;
  breakdown: Record<string, number>;
}

export function recomendarTipo(
  anclas:     Ancla[],
  candidatos: CandidatoRelleno[],
): { recomendado: ContainerType | null; evaluaciones: EvaluacionTipo[] } {
  const evaluaciones: EvaluacionTipo[] = [];

  for (const ctype of ALL_CONTAINER_TYPES) {
    try {
      const result = resolverPedido(anclas, candidatos, ctype, null);
      if (result.config.bins.length === 0) continue;
      const bins = result.config.bins;
      evaluaciones.push({
        ctype,
        score:    result.config.score,
        nBins:    bins.length,
        allValid: bins.every(estaEnVentana),
        pctPeso:  bins.reduce((s, b) => s + pctPeso(b), 0) / bins.length,
        pctVol:   bins.reduce((s, b) => s + pctVol(b),  0) / bins.length,
        degraded: result.config.degraded,
        breakdown: result.scoreBreakdown,
      });
    } catch { /* skip */ }
  }

  evaluaciones.sort((a, b) => {
    if (a.allValid !== b.allValid) return b.allValid ? 1 : -1;
    return b.score - a.score;
  });

  return { recomendado: evaluaciones[0]?.ctype ?? null, evaluaciones };
}

// ─── Top-off ──────────────────────────────────────────────────────────────────

export interface SugerenciaSKU {
  sku:    number;
  desc:   string;
  cajas:  number;
  fuente: 'complemento' | 'fallback';
  pesoCaja: number;
  volCaja:  number;
  pzsCaja:  number;
}

export interface TopOffSugerencia {
  binIdx:         number;
  pctPesoAntes:   number;
  pctVolAntes:    number;
  pctPesoDespues: number;
  pctVolDespues:  number;
  sugerencias:    SugerenciaSKU[];
}

export function generarTopOff(
  bins:           BinState[],
  candidatos:     CandidatoRelleno[],
  anclasUsuario:  Ancla[],
): TopOffSugerencia[] {
  const resultado: TopOffSugerencia[] = [];

  for (let i = 0; i < bins.length; i++) {
    if (estaEnVentana(bins[i])) continue;

    const sim = copyBin(bins[i]);
    const pctPesoAntes = pctPeso(sim);
    const pctVolAntes  = pctVol(sim);
    const sugerencias: SugerenciaSKU[] = [];
    const skusEnBin = new Set(sim.assignments.map(a => a.sku));

    // Pasada 1: complementos (no anclas)
    const skusAncla = new Set(anclasUsuario.map(a => a.sku));
    const comps = candidatos.filter(c => {
      if (skusEnBin.has(c.sku)) return false;
      if (c.estado === 'SOBRESTOCK') return false;
      if (c.cajasMax <= 0) return false;
      const cmin = Math.ceil(MIN_PZS_TOP_OFF / c.pzsCaja);
      if (cmin * c.pesoCaja > espacioPesoFisico(sim) + 1e-6) return false;
      if (cmin * c.volCaja  > espacioVolFisico(sim)  + 1e-6) return false;
      return true;
    });

    const scored = comps
      .map(c => ({ c, score: scoreSkuCandidato(c, espacioPesoFisico(sim), espacioVolFisico(sim)) }))
      .sort((a, b) => b.score - a.score);

    for (const { c } of scored) {
      if (estaEnVentana(sim)) break;
      const espP = espacioPesoFisico(sim);
      const espV = espacioVolFisico(sim);
      const cmin  = Math.ceil(MIN_PZS_TOP_OFF / c.pzsCaja);
      const cajas = Math.min(c.cajasMax, Math.floor(espP / c.pesoCaja), Math.floor(espV / c.volCaja));
      if (cajas < cmin) continue;
      addAssignment(sim, { sku: c.sku, cajas, pesoCaja: c.pesoCaja, volCaja: c.volCaja, pzsCaja: c.pzsCaja, role: 'relleno', desc: c.desc });
      sugerencias.push({ sku: c.sku, desc: c.desc, cajas, fuente: 'complemento', pesoCaja: c.pesoCaja, volCaja: c.volCaja, pzsCaja: c.pzsCaja });
    }

    // Pasada 2: fallback a anclas del usuario
    if (!estaEnVentana(sim)) {
      for (const ancla of anclasUsuario) {
        if (!ancla.cajasMaxFallback || ancla.cajasMaxFallback <= 0) continue;
        const espP = espacioPesoFisico(sim);
        const espV = espacioVolFisico(sim);
        const cajas = Math.min(ancla.cajasMaxFallback, Math.floor(espP / ancla.pesoCaja), Math.floor(espV / ancla.volCaja));
        if (cajas <= 0) continue;
        addAssignment(sim, { sku: ancla.sku, cajas, pesoCaja: ancla.pesoCaja, volCaja: ancla.volCaja, pzsCaja: ancla.pzsCaja, role: 'relleno', desc: ancla.desc });
        sugerencias.push({ sku: ancla.sku, desc: ancla.desc, cajas, fuente: 'fallback', pesoCaja: ancla.pesoCaja, volCaja: ancla.volCaja, pzsCaja: ancla.pzsCaja });
        if (estaEnVentana(sim)) break;
      }
    }

    if (sugerencias.length > 0) {
      resultado.push({
        binIdx: i,
        pctPesoAntes,
        pctVolAntes,
        pctPesoDespues: pctPeso(sim),
        pctVolDespues:  pctVol(sim),
        sugerencias,
      });
    }
  }

  return resultado;
}

export function aplicarTopOff(bins: BinState[], sugerencias: TopOffSugerencia[]): void {
  for (const s of sugerencias) {
    const b = bins[s.binIdx];
    for (const sk of s.sugerencias) {
      addAssignment(b, { sku: sk.sku, cajas: sk.cajas, pesoCaja: sk.pesoCaja, volCaja: sk.volCaja, pzsCaja: sk.pzsCaja, role: 'relleno', desc: sk.desc });
    }
  }
}

// ─── Escenario A (greedy de recorte) ─────────────────────────────────────────

export interface AnclaConContexto {
  ancla:   Ancla;
  dI:      number;
  cobDias: number;
  estado:  string;
}

export interface Recorte {
  sku:              number;
  desc:             string;
  cajasOriginales:  number;
  cajasFinales:     number;
  cajasRemovidas:   number;
  razon:            string;
}

export interface ScenarioAResult {
  anclaAjustadas: Ancla[];
  recortes:       Recorte[];
  feasible:       boolean;
  totalPeso:      number;
  totalVol:       number;
}

function valorAnclaCtx(ctx: AnclaConContexto): number {
  const urg = SEMAFORO_FACTOR[ctx.estado] ?? 0.5;
  const urgAdj = urg === 0 ? 0.5 : urg;
  const pzsOrig = ctx.ancla.cajas * ctx.ancla.pzsCaja;
  return urgAdj * Math.max(ctx.dI, 0.01) * Math.sqrt(pzsOrig);
}

export function resolverEscenarioA(
  anclasCxt: AnclaConContexto[],
  ctype:     ContainerType,
  nMax:      number,
): ScenarioAResult {
  const maxPeso = nMax * ctype.pesoMaxKg;
  const maxVol  = nMax * ctype.volMaxM3;

  const anclas = anclasCxt.map(ctx => ({ ...ctx.ancla }));
  const recortes: Recorte[] = [];

  let totalPeso = anclas.reduce((s, a) => s + a.cajas * a.pesoCaja, 0);
  let totalVol  = anclas.reduce((s, a) => s + a.cajas * a.volCaja,  0);

  if (totalPeso <= maxPeso && totalVol <= maxVol) {
    return { anclaAjustadas: anclas, recortes: [], feasible: true, totalPeso, totalVol };
  }

  // Cortar los menos valiosos primero
  const ctxOrdenados = [...anclasCxt].sort((a, b) => valorAnclaCtx(a) - valorAnclaCtx(b));

  for (const ctx of ctxOrdenados) {
    if (totalPeso <= maxPeso && totalVol <= maxVol) break;
    const ancla = anclas.find(a => a.sku === ctx.ancla.sku);
    if (!ancla || ancla.cajas <= 0) continue;

    const cajasOriginales = ancla.cajas;
    const excesoPeso = Math.max(0, totalPeso - maxPeso);
    const excesoVol  = Math.max(0, totalVol  - maxVol);
    const caPorPeso  = ancla.pesoCaja > 0 ? Math.ceil(excesoPeso / ancla.pesoCaja) : 0;
    const caPorVol   = ancla.volCaja  > 0 ? Math.ceil(excesoVol  / ancla.volCaja)  : 0;
    const cajasARemover = Math.min(ancla.cajas, Math.max(caPorPeso, caPorVol));
    if (cajasARemover <= 0) continue;

    totalPeso  -= cajasARemover * ancla.pesoCaja;
    totalVol   -= cajasARemover * ancla.volCaja;
    ancla.cajas -= cajasARemover;

    recortes.push({
      sku: ancla.sku,
      desc: ancla.desc,
      cajasOriginales,
      cajasFinales:   ancla.cajas,
      cajasRemovidas: cajasARemover,
      razon: ancla.cajas === 0 ? 'Ancla eliminada' : 'Ancla reducida',
    });
  }

  const anclaAjustadas = anclas.filter(a => a.cajas > 0);
  const feasible = totalPeso <= maxPeso + 1 && totalVol <= maxVol + 1;
  return { anclaAjustadas, recortes, feasible, totalPeso, totalVol };
}
