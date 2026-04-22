// ==========================================
// Productivity JABIL DR - FIREBASE REALTIME
// ==========================================

const globalHours = [
    "07:00 - 08:00", "08:00 - 09:00", "09:00 - 10:00", "10:00 - 11:00",
    "11:00 - 12:00", "12:00 - 13:00", "13:00 - 14:00", "14:00 - 15:00",
    "15:00 - 16:00", "16:00 - 17:00", "17:00 - 18:00", "18:00 - 19:00",
    "19:00 - 20:00", "20:00 - 21:00", "21:00 - 22:00", "22:00 - 23:00", "23:00 - 00:00"
];

let appTechnicians = [];
let productivityData = {};
let downtimeData = {}; // Nuevo: Almacena paradas
let productivityChartInstance = null;
let downtimeChartInstance = null; // Nuevo: Gráfica de paradas
let shiftGoal = 0; // Meta de unidades por turno

// ------------------------------------------
// FIREBASE - Listeners en Tiempo Real
// ------------------------------------------
function setupFirebaseListeners() {
    // Verificar que Firebase está disponible
    if (!window.db) {
        console.error("❌ Firebase no disponible. Revisa las credenciales en index.html.");
        loadLocalFallback();
        return;
    }

    console.log("✅ Firebase activo. Escuchando cambios en tiempo real...");
    updateSyncStatus(true);

    // Escuchar meta del turno
    window.db.ref('config/shiftGoal').on('value', (snapshot) => {
        shiftGoal = snapshot.val() || 0;
        const goalInput = document.getElementById('shift-goal-input');
        if (goalInput && shiftGoal > 0) goalInput.value = shiftGoal;
        updateKPIs();
    });

    // Escuchar técnicos en tiempo real
    window.db.ref('techs').on('value', (snapshot) => {
        const data = snapshot.val();
        appTechnicians = data ? Object.values(data) : [];
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        populateAllTechSelects(); // Nueva función centralizada
        refreshUI();
    }, (error) => {
        console.error("Error leyendo técnicos:", error);
        updateSyncStatus(false);
    });

    // Escuchar datos de productividad en tiempo real
    // Firebase devuelve objetos cuando se usa .push(), los convertimos a arrays
    window.db.ref('productivity').on('value', (snapshot) => {
        const raw = snapshot.val() || {};

        // Convertir objetos de Firebase (.push) a arrays planos
        productivityData = {};
        Object.keys(raw).forEach(day => {
            productivityData[day] = {};
            Object.keys(raw[day] || {}).forEach(techId => {
                productivityData[day][techId] = {};
                Object.keys(raw[day][techId] || {}).forEach(rawHourKey => {
                    const hourData = raw[day][techId][rawHourKey];

                    // Normalizar clave: "23-00_-_24-00" → "23-00_-_00-00"
                    // Esto corrige datos guardados antes del fix de medianoche
                    const normalizedKey = rawHourKey.replace(/_-_24-00$/, '_-_00-00');

                    const existing = productivityData[day][techId][normalizedKey] || [];

                    let entries;
                    if (hourData && typeof hourData === 'object' && !Array.isArray(hourData)) {
                        entries = Object.values(hourData);
                    } else {
                        entries = Array.isArray(hourData) ? hourData : [];
                    }

                    // Combinar con entradas existentes bajo la clave normalizada
                    productivityData[day][techId][normalizedKey] = [...existing, ...entries];
                });
            });
        });

        localStorage.setItem('jabil_proto_data', JSON.stringify(productivityData));
        renderDashboard();
        updateKPIs();
        updateTotalGlobal();
        updateSyncStatus(true);
    }, (error) => {
        console.error("Error leyendo productividad:", error);
        updateSyncStatus(false);
    });

    // Escuchar paradas en tiempo real
    window.db.ref('downtime').on('value', (snapshot) => {
        downtimeData = snapshot.val() || {};
        if (document.getElementById('grafica-view')?.classList.contains('active')) renderDowntimeChart();
    });
}

function loadLocalFallback() {
    appTechnicians = JSON.parse(localStorage.getItem('jabil_techs_list') || '[]');
    productivityData = JSON.parse(localStorage.getItem('jabil_proto_data') || '{}');
    if (appTechnicians.length === 0) {
        appTechnicians = [{ id: "JB-001", name: "Técnico Demo", pin: "1234" }];
    }
    refreshUI();
    updateKPIs();
    updateTotalGlobal();
}

// ------------------------------------------
// GUARDAR EN FIREBASE
// ------------------------------------------
async function saveTechToFirebase(tech) {
    if (!window.db) {
        // Sin Firebase: guardar en localStorage
        const idx = appTechnicians.findIndex(t => t.id === tech.id);
        if (idx >= 0) appTechnicians[idx] = tech;
        else appTechnicians.push(tech);
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        refreshUI();
        return;
    }
    await window.db.ref(`techs/${tech.id}`).set(tech);
}

async function deleteTechFromFirebase(techId) {
    if (!window.db) {
        appTechnicians = appTechnicians.filter(t => t.id !== techId);
        localStorage.setItem('jabil_techs_list', JSON.stringify(appTechnicians));
        refreshUI();
        return;
    }
    await window.db.ref(`techs/${techId}`).remove();
}

async function pushProductivityEntries(day, techId, hour, newEntries) {
    const safehour = hour.replace(/:/g, '-').replace(/ /g, '_');

    if (!window.db) {
        // Sin Firebase: acumular en local
        if (!productivityData[day]) productivityData[day] = {};
        if (!productivityData[day][techId]) productivityData[day][techId] = {};
        if (!productivityData[day][techId][safehour]) productivityData[day][techId][safehour] = [];
        newEntries.forEach(e => productivityData[day][techId][safehour].push(e));
        localStorage.setItem('jabil_proto_data', JSON.stringify(productivityData));
        renderDashboard();
        updateKPIs();
        updateTotalGlobal();
        return;
    }

    // Con Firebase: usar .push() para cada entrada (acumulativo, nunca sobreescribe)
    const ref = window.db.ref(`productivity/${day}/${techId}/${safehour}`);
    const pushPromises = newEntries.map(entry => ref.push(entry));
    await Promise.all(pushPromises);
}

// ------------------------------------------
// UI Helpers
// ------------------------------------------
function populateAllTechSelects() {
    const selects = ['tech-select', 'hist-tech-filter', 'delete-tech-filter', 'downtime-tech-select'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const currentVal = el.value;
        
        // Limpiar
        el.innerHTML = '';
        
        // Agregar opción por defecto según el tipo de select
        if (id.includes('filter')) {
            el.innerHTML = '<option value="">Todos los técnicos</option>';
        } else {
            el.innerHTML = '<option value="" disabled selected>Selecciona técnico...</option>';
        }

        // Poblar
        appTechnicians.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            el.appendChild(opt);
        });

        if (currentVal) el.value = currentVal;
    });
}

function refreshUI() {
    if (window.renderAdminTable) window.renderAdminTable();
    renderDashboard();
}

function updateSyncStatus(online) {
    const el = document.getElementById('last-sync-time');
    if (!el) return;
    const t = new Date();
    const time = `${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
    el.innerHTML = online
        ? `<i class="fa-solid fa-cloud-check" style="color:#22c55e"></i> Sync: ${time}`
        : `<i class="fa-solid fa-cloud-slash" style="color:#ef4444"></i> Sin conexión`;
}

// ------------------------------------------
// KPIs
// ------------------------------------------
function updateKPIs() {
    const today = new Date().toISOString().split('T')[0];
    const monthPrefix = today.substring(0, 7);

    let shiftLeader = { name: "---", count: 0 };
    let monthLeader = { name: "---", count: 0, photo: null };
    let totalToday = 0;
    const dailyTotals = {};
    const monthlyTotals = {};

    Object.keys(productivityData).forEach(day => {
        Object.keys(productivityData[day] || {}).forEach(tid => {
            let count = 0;
            Object.values(productivityData[day][tid] || {}).forEach(items => {
                count += Array.isArray(items) ? items.length : 0;
            });
            if (day === today) {
                dailyTotals[tid] = (dailyTotals[tid] || 0) + count;
                totalToday += count;
            }
            if (day.startsWith(monthPrefix)) {
                monthlyTotals[tid] = (monthlyTotals[tid] || 0) + count;
            }
        });
    });

    Object.keys(dailyTotals).forEach(tid => {
        if (dailyTotals[tid] > shiftLeader.count) {
            const t = appTechnicians.find(t => t.id === tid);
            shiftLeader = { name: t ? t.name : tid, count: dailyTotals[tid] };
        }
    });
    Object.keys(monthlyTotals).forEach(tid => {
        if (monthlyTotals[tid] > monthLeader.count) {
            const t = appTechnicians.find(t => t.id === tid);
            monthLeader = { 
                name: t ? t.name : tid, 
                count: monthlyTotals[tid],
                photo: t ? t.photo : null
            };
        }
    });

    // --- Eficiencia basada en Meta Individual por Técnico ---
    const effEl = document.getElementById('avg-efficiency');
    const effDetail = document.getElementById('efficiency-detail');
    const projEl = document.getElementById('shift-projection');
    const projDetail = document.getElementById('projection-detail');

    // Calcular eficiencia promedio ponderada de todos los técnicos con meta
    let totalEffPct = 0;
    let techsWithGoal = 0;
    const now = new Date();
    const hoursWorked = Math.max(0.5, now.getHours() + now.getMinutes() / 60 - 7);
    const hoursLeft = Math.max(0, 15 - now.getHours() - now.getMinutes() / 60);
    let teamProjection = 0;

    appTechnicians.forEach(tech => {
        const techGoal = parseInt(tech.goal) || 0;
        const techTotal = dailyTotals[tech.id] || 0;
        if (techGoal > 0) {
            totalEffPct += (techTotal / techGoal) * 100;
            techsWithGoal++;
            const rate = techTotal / hoursWorked;
            teamProjection += Math.round(techTotal + rate * hoursLeft);
        }
    });

    if (techsWithGoal > 0) {
        const avgEff = Math.round(totalEffPct / techsWithGoal);
        const totalGoal = appTechnicians.reduce((s, t) => s + (parseInt(t.goal) || 0), 0);
        if (effEl) { effEl.textContent = `${avgEff}%`; effEl.style.color = avgEff >= 100 ? '#22c55e' : avgEff >= 70 ? '#f59e0b' : '#ef4444'; }
        if (effDetail) effDetail.textContent = `Promedio equipo (${techsWithGoal} técnicos con meta)`;
        if (projEl) { projEl.textContent = teamProjection; projEl.style.color = teamProjection >= totalGoal ? '#22c55e' : '#ef4444'; }
        if (projDetail) projDetail.textContent = teamProjection >= totalGoal ? '✅ Equipo alcanzará la meta' : `⚠️ Faltan ~${Math.max(0, totalGoal - teamProjection)} unidades`;
    } else {
        let h = now.getHours() - 7;
        if (h <= 0) h = 1;
        const rate = (totalToday / h).toFixed(1);
        if (effEl) { effEl.textContent = rate; effEl.style.color = ''; }
        if (effDetail) effDetail.textContent = 'unidades/hora (configura metas en Admin)';
        if (projEl) projEl.textContent = '---';
        if (projDetail) projDetail.textContent = 'Agrega meta a cada técnico';
    }

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('total-hoy', totalToday);
    set('shift-leader-name', shiftLeader.name);
    set('shift-leader-count', `${shiftLeader.count} unidades`);
    set('month-leader-name', monthLeader.name);
    set('month-leader-count', `${monthLeader.count} unidades`);

    // Actualizar foto del líder del mes
    const photoContainer = document.getElementById('month-leader-photo');
    if (photoContainer) {
        photoContainer.innerHTML = monthLeader.photo 
            ? `<img src="${monthLeader.photo}" style="width:100%; height:100%; object-fit:cover;">`
            : '<i class="fa-solid fa-user" style="font-size:2rem; opacity:0.3;"></i>';
    }
}

function updateTotalGlobal() {
    const start = document.getElementById('filter-date-start')?.value || '';
    const end = document.getElementById('filter-date-end')?.value || '';
    let total = 0;
    Object.keys(productivityData).forEach(d => {
        if (d >= start && d <= end) {
            Object.values(productivityData[d] || {}).forEach(tData =>
                Object.values(tData || {}).forEach(items => { total += Array.isArray(items) ? items.length : 0; })
            );
        }
    });
    const el = document.getElementById('total-hoy');
    if (el) el.textContent = total;
}

// ------------------------------------------
// INIT
// ------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    setupFirebaseListeners();
    updateDate();
    initNavigation();
    initForm();
    initAdmin();
    initHistorial();

    // Poblar inicial con caché si existe
    const cached = localStorage.getItem('jabil_techs_list');
    if (cached) {
        appTechnicians = JSON.parse(cached);
        populateAllTechSelects();
    }

    if (localStorage.getItem('jabil_theme') === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
    }
});

// ------------------------------------------
// DATE / CLOCK
// ------------------------------------------
function updateDateDisplay() {
    const el = document.getElementById('current-date');
    if (el) el.textContent = new Date().toLocaleDateString('es-DO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function updateDate() {
    updateDateDisplay();

    const nowStr = new Date().toISOString().split('T')[0];
    const s = document.getElementById('filter-date-start');
    const e = document.getElementById('filter-date-end');
    if (s && !s.value) s.value = nowStr;
    if (e && !e.value) e.value = nowStr;

    [s, e].forEach(el => {
        if (el) el.addEventListener('change', () => {
            // Si el usuario cambia la fecha manualmente, marcar que ya no es "Auto Today"
            const nowStr = new Date().toISOString().split('T')[0];
            if (el.value !== nowStr) el.dataset.isAutoToday = "false";
            else el.dataset.isAutoToday = "true";

            updateKPIs();
            renderDashboard();
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderChart();
        });
    });

    initClock();

    // Verificación de cambio de día (reset a medianoche)
    setInterval(() => {
        const nowStr = new Date().toISOString().split('T')[0];
        const s = document.getElementById('filter-date-start');
        const e = document.getElementById('filter-date-end');
        
        // Si el día cambió y estamos viendo "hoy", actualizar filtros automáticamente
        if (s && e && s.value !== nowStr && s.dataset.isAutoToday !== "false") {
            console.log("🕛 Medianoche detectada. Reiniciando dashboard para el nuevo día...");
            s.value = nowStr;
            e.value = nowStr;
            updateDateDisplay(); // Actualizar el texto largo de la fecha
            updateKPIs();
            renderDashboard();
            if (document.getElementById('grafica-view')?.classList.contains('active')) renderChart();
        }
    }, 60000); // Revisar cada minuto

    const tt = document.getElementById('theme-toggle');
    if (tt) {
        tt.addEventListener('click', () => {
            const dark = document.body.getAttribute('data-theme') === 'dark';
            document.body.setAttribute('data-theme', dark ? 'light' : 'dark');
            localStorage.setItem('jabil_theme', dark ? 'light' : 'dark');
            tt.innerHTML = dark ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
        });
    }

    const exp = document.getElementById('btn-export-excel');
    if (exp) exp.addEventListener('click', exportToExcel);
}

function initClock() {
    const el = document.getElementById('live-clock-display');
    if (el) setInterval(() => { el.textContent = new Date().toLocaleTimeString('es-DO', { hour12: false }); }, 1000);
}

// ------------------------------------------
// NAVIGATION
// ------------------------------------------
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const views = document.querySelectorAll('.view');
    const modal = document.getElementById('admin-auth-modal');
    const passInput = document.getElementById('admin-password-input');
    let authCb = null;

    window.showAdminAuthModal = (cb) => {
        authCb = cb;
        passInput.value = '';
        const stored = localStorage.getItem('jabil_admin_password');
        document.getElementById('auth-modal-desc').textContent = stored ? "Ingresa la Clave Maestra." : "Crea una Clave Maestra (mínimo 3 caracteres):";
        modal.classList.add('active');
        setTimeout(() => passInput.focus(), 100);
    };

    document.getElementById('btn-auth-cancel').onclick = () => modal.classList.remove('active');
    document.getElementById('btn-auth-submit').onclick = () => {
        const val = passInput.value;
        const stored = localStorage.getItem('jabil_admin_password');
        if (!stored && val.length >= 3) {
            localStorage.setItem('jabil_admin_password', val);
            modal.classList.remove('active');
            if (authCb) authCb();
        } else if (val === stored) {
            modal.classList.remove('active');
            if (authCb) authCb();
        } else {
            alert("Clave incorrecta.");
        }
    };

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const action = () => {
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                views.forEach(v => v.classList.remove('active'));
                document.getElementById(targetId).classList.add('active');
                
                // Asegurar que los técnicos aparezcan al navegar
                populateAllTechSelects();

                if (targetId === 'dashboard-view') renderDashboard();
                if (targetId === 'grafica-view') {
                    renderChart();
                    renderDowntimeChart();
                }
                if (targetId === 'historial-view') renderHistorial();
            };
            if (targetId === 'tecnicos-view') window.showAdminAuthModal(action);
            else action();
        });
    });
}

// ------------------------------------------
// FORM (Registro)
// ------------------------------------------
function initForm() {
    const techSelect = document.getElementById('tech-select');
    const form = document.getElementById('registro-form');

    window.refreshTechSelect = () => {
        if (!techSelect) return;
        const cur = techSelect.value;
        techSelect.innerHTML = '<option value="" disabled selected>Selecciona un técnico</option>';
        appTechnicians.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            techSelect.appendChild(opt);
        });
        if (cur) techSelect.value = cur;
    };

    let isAuth = false;
    techSelect.addEventListener('change', () => {
        if (isAuth) return;
        const tech = appTechnicians.find(t => t.id === techSelect.value);
        if (tech && tech.pin) {
            isAuth = true;
            showTechPinModal(tech,
                () => { isAuth = false; document.getElementById('scanner-input')?.focus(); },
                () => { isAuth = false; techSelect.value = ''; }
            );
        }
    });

    const numInput = document.getElementById('repairs-input');
    document.querySelector('.decrease').onclick = () => { if (numInput.value > 1) numInput.value--; };
    document.querySelector('.increase').onclick = () => { numInput.value++; };

    const scanner = document.getElementById('scanner-input');
    if (scanner) {
        scanner.addEventListener('keypress', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // EVITAR QUE EL FORMULARIO SE ENVÍE DOS VECES (scanner + submit)
            const val = scanner.value.trim();
            if (!val) return;
            const found = appTechnicians.find(t => t.id === val);
            if (found) { techSelect.value = found.id; scanner.value = ''; return; }
            const tid = techSelect.value;
            if (!tid) { alert('Selecciona un técnico primero.'); scanner.value = ''; return; }
            await submitEntry(tid, [val]);
            scanner.value = '';
        });
    }

    if (form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            const tid = techSelect.value;
            if (!tid) return;
            const qty = parseInt(numInput.value) || 1;
            await submitEntry(tid, Array(qty).fill("Manual"));
            numInput.value = 1;
        };
    }
}

function autoDetectHour() {
    const h = new Date().getHours();
    const nextH = (h + 1) % 24; // Fix: 23+1=00, no 24
    return `${h.toString().padStart(2,'0')}:00 - ${nextH.toString().padStart(2,'0')}:00`;
}

async function submitEntry(techId, serials) {
    const day = new Date().toISOString().split('T')[0];
    const hour = autoDetectHour();
    const ts = new Date().toLocaleTimeString('es-DO', { hour12: false }).substring(0, 5);
    const comment = document.getElementById('entry-comment')?.value || "";

    // Construir las nuevas entradas a agregar
    const newEntries = serials.map(s => ({ 
        serial: s, 
        timestamp: ts,
        comment: comment 
    }));

    // Usar push() para SUMAR al acumulado existente, nunca reemplazar
    await pushProductivityEntries(day, techId, hour, newEntries);
    
    // Limpiar comentario después de guardar
    if (document.getElementById('entry-comment')) document.getElementById('entry-comment').value = '';
    
    showSuccessToast();
}

async function submitDowntime(techId, minutes, cause, comment) {
    const day = new Date().toISOString().split('T')[0];
    const hour = autoDetectHour();
    const ts = new Date().toLocaleTimeString('es-DO', { hour12: false }).substring(0, 5);
    const safeHour = hour.replace(/:/g, '-').replace(/ /g, '_');

    const entry = {
        techId,
        minutes,
        cause,
        comment,
        timestamp: ts
    };

    if (window.db) {
        await window.db.ref(`downtime/${day}/${safeHour}`).push(entry);
    }
    showToast("Parada registrada correctamente", "success");
}

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'success-toast';
    toast.style.display = 'flex';
    toast.style.background = type === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(239, 68, 68, 0.95)';
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${msg}`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

function showSuccessToast() {
    showToast("¡Registro Exitoso!", "success");
    setTimeout(() => {
        document.querySelector('[data-target="dashboard-view"]')?.click();
    }, 1500);
}

// ------------------------------------------
// DASHBOARD TABLE
// ------------------------------------------
function getFilteredItems(techId, hour) {
    const start = document.getElementById('filter-date-start')?.value || '';
    const end = document.getElementById('filter-date-end')?.value || '';
    let items = [];

    // Generar variantes de clave (nueva y la vieja con "24:00")
    const safehour = hour.replace(/:/g, '-').replace(/ /g, '_');
    // Variante antigua: "23:00 - 00:00" podría estar guardada como "23:00 - 24:00"
    const altHour = hour.replace('- 00:00', '- 24:00');
    const altSafehour = altHour.replace(/:/g, '-').replace(/ /g, '_');

    Object.keys(productivityData).forEach(day => {
        if (day >= start && day <= end) {
            const techData = productivityData[day]?.[techId];
            if (!techData) return;

            // Buscar en clave nueva, clave antigua y clave original (sin transformar)
            [safehour, altSafehour, hour, altHour].forEach(key => {
                const hourData = techData[key];
                if (Array.isArray(hourData) && hourData.length > 0) {
                    items.push(...hourData);
                }
            });
        }
    });

    // Eliminar duplicados por si la misma entrada aparece bajo dos claves
    const seen = new Set();
    return items.filter(item => {
        const k = JSON.stringify(item);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function renderDashboard() {
    const header = document.getElementById('table-header-row');
    const body = document.getElementById('dashboard-table-body');
    if (!header || !body) return;

    // Dashboard: mostrar % eficiencia por técnico
    header.innerHTML = '<th>Técnico</th><th>Meta</th>' + globalHours.map(h => `<th>${h}</th>`).join('') + '<th class="total-col">Total</th><th class="total-col">Efic.</th>';

    body.innerHTML = appTechnicians.map(tech => {
        let rowTotal = 0;
        const cells = globalHours.map(hour => {
            const val = getFilteredItems(tech.id, hour).length;
            rowTotal += val;
            const cls = val === 0 ? 'zero' : val <= 5 ? 'heat-low' : val <= 10 ? 'heat-med' : 'heat-high';
            return `<td class="val-cell ${cls}">${val > 0 ? val : '-'}</td>`;
        }).join('');

        const goal = parseInt(tech.goal) || 0;
        const effPct = goal > 0 ? Math.round((rowTotal / goal) * 100) : null;
        const effColor = effPct === null ? '#888' : effPct >= 100 ? '#22c55e' : effPct >= 70 ? '#f59e0b' : '#ef4444';
        const effText = effPct !== null ? `${effPct}%` : 'N/A';
        const goalText = goal > 0 ? goal : '-';

        return `<tr>
            <td>${tech.name}</td>
            <td style="color:#f59e0b; font-weight:600;">${goalText}</td>
            ${cells}
            <td class="val-cell total-col">${rowTotal}</td>
            <td class="val-cell total-col" style="color:${effColor}; font-weight:700;">${effText}</td>
        </tr>`;
    }).join('');
}

// ------------------------------------------
// CHART
// ------------------------------------------
function renderChart() {
    const canvas = document.getElementById('productivityChart');
    if (!canvas) return;
    const datasets = appTechnicians.map((tech, i) => ({
        label: tech.name,
        data: globalHours.map(h => getFilteredItems(tech.id, h).length),
        backgroundColor: `hsla(${i * 50}, 70%, 55%, 0.75)`
    }));
    if (productivityChartInstance) productivityChartInstance.destroy();
    productivityChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: globalHours.map(h => h.split(' ')[0]), datasets },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderDowntimeChart() {
    const canvas = document.getElementById('downtimeChart');
    if (!canvas) {
        console.warn("Canvas 'downtimeChart' no encontrado.");
        return;
    }
    
    // Obtener día actual o del filtro
    const day = document.getElementById('filter-date')?.value || 
                document.getElementById('hist-date-start')?.value || 
                new Date().toISOString().split('T')[0];

    const dataByHour = globalHours.map(h => {
        const safeH = h.replace(/:/g, '-').replace(/ /g, '_');
        const entries = downtimeData[day]?.[safeH] || {};
        let totalMins = 0;
        Object.values(entries).forEach(e => totalMins += (parseInt(e.minutes) || 0));
        return totalMins;
    });

    if (downtimeChartInstance) {
        downtimeChartInstance.destroy();
    }

    const ctx = canvas.getContext('2d');
    downtimeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: globalHours.map(h => h.split(' ')[0]),
            datasets: [{
                label: 'Minutos de Parada',
                data: dataByHour,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Minutos' }
                }
            },
            plugins: {
                legend: { position: 'top' }
            }
        }
    });
}

// ------------------------------------------
// ADMIN - Técnicos
// ------------------------------------------
function showTechPinModal(tech, ok, cancel) {
    const m = document.getElementById('tech-auth-modal');
    const input = document.getElementById('tech-password-input');
    document.getElementById('tech-auth-desc').textContent = `Hola ${tech.name}, ingresa tu PIN:`;
    input.value = '';
    m.classList.add('active');
    setTimeout(() => input.focus(), 100);
    document.getElementById('btn-tech-cancel').onclick = () => { m.classList.remove('active'); cancel(); };
    document.getElementById('btn-tech-submit').onclick = () => {
        if (input.value === tech.pin) { m.classList.remove('active'); ok(); }
        else alert("PIN incorrecto");
    };
}

function initAdmin() {
    const idIn = document.getElementById('new-tech-id');
    const nameIn = document.getElementById('new-tech-name');
    const pinIn = document.getElementById('new-tech-pin');
    const subBtn = document.getElementById('btn-add-tech');
    let editId = null;

    const renderAdminTable = () => {
        const body = document.getElementById('tech-admin-body');
        if (!body) return;
        body.innerHTML = appTechnicians.map(tech => `
            <tr>
                <td><div style="width:35px; height:35px; border-radius:50%; background:rgba(255,255,255,0.1); overflow:hidden; display:flex; align-items:center; justify-content:center;">
                    ${tech.photo ? `<img src="${tech.photo}" style="width:100%; height:100%; object-fit:cover;">` : '<i class="fa-solid fa-user" style="font-size:1rem; opacity:0.3;"></i>'}
                </div></td>
                <td style="font-weight:600;">${tech.id}</td>
                <td>${tech.name}</td>
                <td>${tech.goal || '-'}</td>
                <td>
                    <button class="nav-btn" onclick="editTech('${tech.id}')" style="padding:5px 10px; margin:0;"><i class="fa-solid fa-pen"></i></button>
                    <button class="nav-btn btn-danger" onclick="deleteTech('${tech.id}')" style="padding:5px 10px; margin:0;"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`).join('');
    };

    window.editTech = (id) => {
        editId = id;
        const t = appTechnicians.find(t => t.id === id);
        if (!t) return;
        idIn.value = t.id; idIn.disabled = true;
        nameIn.value = t.name;
        pinIn.value = t.pin;
        document.getElementById('new-tech-goal').value = t.goal || '';
        subBtn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar';
        nameIn.focus();
    };

    window.deleteTech = async (id) => {
        const t = appTechnicians.find(t => t.id === id);
        if (!t) return;
        if (!confirm(`¿Eliminar a ${t.name}?`)) return;
        await deleteTechFromFirebase(id);
    };

    document.getElementById('add-tech-form').onsubmit = async (e) => {
        e.preventDefault();
        const photoInput = document.getElementById('new-tech-photo');
        let photoBase64 = null;

        // Si estamos editando y no hay foto nueva, mantener la anterior
        if (editId) {
            const existing = appTechnicians.find(t => t.id === editId);
            photoBase64 = existing?.photo || null;
        }

        if (photoInput.files && photoInput.files[0]) {
            const reader = new FileReader();
            photoBase64 = await new Promise((resolve) => {
                reader.onload = (ev) => resolve(ev.target.result);
                reader.readAsDataURL(photoInput.files[0]);
            });
        }

        const tech = {
            id: idIn.value.trim(),
            name: nameIn.value.trim(),
            pin: pinIn.value.trim(),
            goal: parseInt(document.getElementById('new-tech-goal').value) || 0,
            photo: photoBase64
        };
        if (!tech.id || !tech.name || !tech.pin) return;
        await saveTechToFirebase(tech);
        editId = null;
        idIn.value = ''; idIn.disabled = false;
        nameIn.value = ''; pinIn.value = '';
        document.getElementById('new-tech-goal').value = '';
        photoInput.value = ''; // Limpiar input file
        subBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Añadir Técnico';
    };

    // --- MANTENIMIENTO DE DATOS ---
    const btnDelAll = document.getElementById('btn-delete-all');
    const btnDelPeriod = document.getElementById('btn-delete-period');

    if (btnDelAll) {
        console.log("Btn delete all detected");
        btnDelAll.onclick = async () => {
            if (!confirm("🚨 ¿ESTÁS SEGURO? Esta acción borrará TODO el historial de productividad permanentemente.")) return;
            if (!confirm("⚠️ SEGUNDA CONFIRMACIÓN: ¿Realmente quieres limpiar toda la base de datos para iniciar producción?")) return;
            
            try {
                if (window.db) {
                    await window.db.ref('productivity').remove();
                    productivityData = {}; // Limpiar local tmb
                    showToast("Historial borrado con éxito", "success");
                } else {
                    productivityData = {};
                    localStorage.setItem('jabil_proto_data', '{}');
                    refreshUI();
                    showToast("Datos locales borrados", "success");
                }
            } catch (err) {
                console.error("Error al borrar:", err);
                alert("Error al borrar: " + err.message);
            }
        };
    }

    if (btnDelPeriod) {
        btnDelPeriod.onclick = async () => {
            const start = document.getElementById('delete-date-start').value;
            const end = document.getElementById('delete-date-end').value;
            const techFilter = document.getElementById('delete-tech-filter').value;
            const hourFilter = document.getElementById('delete-hour-filter').value;
            const qty = parseInt(document.getElementById('delete-quantity').value) || 0;

            if (!start || !end) { alert("Selecciona ambas fechas (Inicio y Fin)."); return; }
            if (start > end) { alert("La fecha de inicio no puede ser mayor a la de fin."); return; }

            let confirmMsg = qty > 0 
                ? `¿REDUCIR ${qty} unidades de los registros seleccionados?`
                : `¿BORRAR TODO el contenido de los registros seleccionados?`;
            
            if (techFilter) confirmMsg += `\nTécnico: ${techFilter}`;
            if (hourFilter) confirmMsg += `\nHora: ${hourFilter}`;

            if (!confirm(confirmMsg)) return;

            try {
                if (window.db) {
                    const updates = {};
                    const safeHourFilter = hourFilter ? hourFilter.replace(/:/g, '-').replace(/ /g, '_') : null;

                    // Necesitamos obtener los datos frescos de Firebase si vamos a reducir por cantidad
                    // para saber qué IDs de entrada borrar exactamente.
                    const snapshot = await window.db.ref('productivity').once('value');
                    const raw = snapshot.val() || {};

                    Object.keys(raw).forEach(day => {
                        if (day >= start && day <= end) {
                            Object.keys(raw[day] || {}).forEach(techId => {
                                if (techFilter && techId !== techFilter) return;

                                Object.keys(raw[day][techId] || {}).forEach(rawHourKey => {
                                    const normalizedKey = rawHourKey.replace(/_-_24-00$/, '_-_00-00');
                                    const safeHourToCompare = safeHourFilter ? safeHourFilter.replace(/_-_24-00$/, '_-_00-00') : null;

                                    if (safeHourToCompare && normalizedKey !== safeHourToCompare) return;

                                    const hourData = raw[day][techId][rawHourKey];
                                    if (!hourData) return;

                                    if (qty > 0) {
                                        // REDUCIR N UNIDADES
                                        const keys = Object.keys(hourData); // Firebase keys de .push()
                                        const toDelete = keys.slice(-qty); // Tomar las últimas N
                                        toDelete.forEach(k => {
                                            updates[`${day}/${techId}/${rawHourKey}/${k}`] = null;
                                        });
                                    } else {
                                        // BORRAR TODO EL SLOT
                                        updates[`${day}/${techId}/${rawHourKey}`] = null;
                                    }
                                });
                            });
                        }
                    });

                    if (Object.keys(updates).length === 0) {
                        showToast("No se encontró data para borrar", "error");
                        return;
                    }

                    await window.db.ref('productivity').update(updates);
                    showToast(qty > 0 ? "Unidades reducidas con éxito" : "Registros borrados", "success");
                    document.getElementById('delete-quantity').value = '';
                } else {
                    showToast("Sin conexión a Firebase", "error");
                }
            } catch (err) {
                console.error("Error en operación:", err);
                alert("Error: " + err.message);
            }
        };
    }

    renderAdminTable();
}

// ------------------------------------------
// EXPORT
// ------------------------------------------
function exportToExcel() {
    // Encabezado detallado: Incluye Serial, Hora Exacta y Comentario
    let csv = "\uFEFFFecha,Técnico,Franja Horaria,Serial,Hora Registro,Comentario\n";
    
    Object.keys(productivityData).sort().reverse().forEach(d => {
        Object.keys(productivityData[d] || {}).forEach(tid => {
            const tech = appTechnicians.find(t => t.id === tid);
            const techName = tech ? tech.name : tid;

            Object.keys(productivityData[d][tid] || {}).forEach(h => {
                const entries = productivityData[d][tid][h];
                if (!Array.isArray(entries)) return;

                entries.forEach(entry => {
                    const serial = entry.serial || "Manual";
                    const timestamp = entry.timestamp || "--:--";
                    const comment = (entry.comment || "").replace(/"/g, '""'); // Escapar comillas
                    const hourRange = h.replace(/--/g, ':').replace(/_-_/g, ' - ').replace(/-/g, ':');
                    
                    csv += `"${d}","${techName}","${hourRange}","${serial}","${timestamp}","${comment}"\n`;
                });
            });
        });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `reporte_detallado_jabil_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

// ------------------------------------------
// HISTORIAL
// ------------------------------------------
function renderHistorial() {
    const body = document.getElementById('historial-body');
    const totalEl = document.getElementById('historial-total');
    if (!body) return;

    const filterTech = document.getElementById('hist-tech-filter')?.value || '';
    const filterStart = document.getElementById('hist-date-start')?.value || '';
    const filterEnd = document.getElementById('hist-date-end')?.value || '';

    const rows = [];
    let grandTotal = 0;

    // Iterar sobre todos los datos de productividad
    Object.keys(productivityData).sort().reverse().forEach(day => {
        if (filterStart && day < filterStart) return;
        if (filterEnd && day > filterEnd) return;

        Object.keys(productivityData[day] || {}).forEach(techId => {
            if (filterTech && techId !== filterTech) return;

            const tech = appTechnicians.find(t => t.id === techId);
            const techName = tech ? tech.name : techId;
            const techGoal = parseInt(tech?.goal) || 0;

            Object.keys(productivityData[day][techId] || {}).forEach(hourKey => {
                const items = productivityData[day][techId][hourKey];
                if (!Array.isArray(items)) return;

                const techGoal = parseInt(tech?.goal) || 0;
                let effText = 'N/A';
                let effColor = '#888';
                if (techGoal > 0) {
                    const goalPerHour = techGoal / 15;
                    const count = items.length;
                    const eff = Math.round((count / goalPerHour) * 100);
                    effText = `${eff}%`;
                    effColor = eff >= 100 ? '#22c55e' : eff >= 70 ? '#f59e0b' : '#ef4444';
                }

                items.forEach(entry => {
                    grandTotal++;
                    rows.push(`<tr>
                        <td>${day}</td>
                        <td><strong>${techName}</strong></td>
                        <td style="font-family:monospace; font-size:0.85rem;">${entry.timestamp || hourKey.split('_-_')[1].replace(/-/g,':')}</td>
                        <td><span style="background:rgba(99,102,241,0.2); padding:3px 10px; border-radius:20px; font-weight:700;">${entry.serial || 'Manual'}</span></td>
                        <td style="color:${effColor}; font-weight:700;">${effText}</td>
                        <td style="font-size:0.8rem; font-style:italic; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${entry.comment || '-'}</td>
                    </tr>`);
                });
            });
        });
    });

    body.innerHTML = rows.length > 0 
        ? rows.join('') 
        : '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:30px;">No hay registros para los filtros seleccionados.</td></tr>';
    
    if (totalEl) totalEl.innerHTML = `<i class="fa-solid fa-sigma"></i> Total filtrado: <strong>${grandTotal} unidades</strong>`;
}

function initHistorial() {
    const nowStr = new Date().toISOString().split('T')[0];
    const s = document.getElementById('hist-date-start');
    const e = document.getElementById('hist-date-end');
    // Default: último mes
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    if (s) s.value = monthAgo.toISOString().split('T')[0];
    if (e) e.value = nowStr;
}
