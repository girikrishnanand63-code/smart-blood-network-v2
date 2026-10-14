/* Smart Blood Donor Network - Frontend Client Engine */
let me = null;
let pendingEmail = null;
let resendTimer = null;

const ROLE_LABELS = { 
    admin: "Administrator", 
    donor: "Blood Donor", 
    recipient: "Blood Seeker (Patient)" 
};

const LOGIN_REQUIRED = ["register-donor", "request-blood", "my-requests", "notifications", "emergency"];

/* ---------- Helpers & Modern Toast System ---------- */
async function api(path, options = {}) {
    const init = { 
        method: options.method || "GET", 
        headers: { "Accept": "application/json" } 
    };
    if (options.body) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(options.body);
    }
    
    let res;
    try {
        res = await fetch("/api" + path, init);
    } catch (networkErr) {
        throw new Error("Cannot connect to server. Check your network status.");
    }

    let data = null;
    try { 
        data = await res.json(); 
    } catch (e) { 
        /* empty response */ 
    }

    if (!res.ok) {
        const errorMsg = (data && data.error) || (data && data.message) || `Request failed (${res.status})`;
        throw new Error(errorMsg);
    }
    return data;
}

function esc(text) {
    const div = document.createElement("div");
    div.textContent = String(text ?? "");
    return div.innerHTML;
}

function showToast(message, type = "error") {
    let toast = document.getElementById("toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast";
        toast.setAttribute("role", "status");
        document.body.appendChild(toast);
    }
    
    const icon = type === "success" ? "✅" : "⚠️";
    toast.innerHTML = `<span style="font-size:16px;">${icon}</span> <span>${esc(message)}</span>`;
    toast.className = `show ${type}`;
    
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { 
        toast.className = ""; 
    }, 4000);
}

async function guarded(form, handler) {
    const btn = form ? form.querySelector("button[type=submit]") : null;
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.7";
        btn.style.cursor = "not-allowed";
    }
    try {
        await handler();
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.style.cursor = "pointer";
        }
    }
}

/* ---------- Session & Dynamic Header State ---------- */
async function refreshMe() {
    try {
        me = (await api("/auth/me")).user;
    } catch (e) {
        me = null;
    }
    updateAuthUI();
}

function updateAuthUI() {
    const toggle = (id, hide) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("hidden", hide);
    };

    toggle("loginBtn", !!me);
    toggle("signupBtn", !!me);
    toggle("notifBtn", !me);
    toggle("adminBtn", !(me && me.role === "admin"));
    toggle("logoutButton", !me);

    const profileLogin = document.querySelector("#profile > button:not(.secondary)");
    if (profileLogin) profileLogin.classList.toggle("hidden", !!me);

    const badge = document.getElementById("notifBadge");
    if (badge) {
        const count = me ? me.pending : 0;
        badge.textContent = count;
        badge.classList.toggle("hidden", count === 0);
    }
}

/* ---------- Smooth Section Navigation ---------- */
async function showSection(id) {
    if (!document.getElementById(id)) id = "home";

    if (LOGIN_REQUIRED.includes(id) && !me) {
        showToast("Please log in first to continue.", "error");
        id = "login";
    }
    if (id === "verify-otp" && !pendingEmail) id = "signup";
    if (id === "admin" && (!me || me.role !== "admin")) {
        showToast("Admin privileges required.", "error");
        id = me ? "home" : "login";
    }

    document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
    const target = document.getElementById(id);
    if (target) {
        target.classList.remove("hidden");
        target.style.animation = "fadeScale 0.25s ease-out";
    }

    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    window.scrollTo({ top: 0, behavior: "smooth" });

    try {
        if (id === "profile") await renderProfile();
        if (id === "history") await renderHistory();
        if (id === "find-donor") await searchDonors();
        if (id === "notifications") { await refreshMe(); await renderNotifications(); }
        if (id === "my-requests") await renderMyRequests();
        if (id === "admin") await renderAdmin();
    } catch (err) {
        showToast(err.message, "error");
    }
}

window.addEventListener("hashchange", () => {
    showSection(location.hash.replace("#", "") || "home");
});

/* ---------- Sign Up & OTP Flow ---------- */
function startResendCooldown(seconds) {
    const btn = document.getElementById("resendOtpBtn");
    if (!btn) return;
    let left = seconds || 60;
    clearInterval(resendTimer);
    btn.disabled = true;
    btn.textContent = `Resend OTP (${left}s)`;

    resendTimer = setInterval(() => {
        left--;
        if (left <= 0) {
            clearInterval(resendTimer);
            btn.disabled = false;
            btn.textContent = "Resend OTP";
        } else {
            btn.textContent = `Resend OTP (${left}s)`;
        }
    }, 1000);
}

document.getElementById("signupForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const email = document.getElementById("signupEmail").value.trim().toLowerCase();
        await api("/auth/signup", {
            method: "POST",
            body: {
                name: document.getElementById("signupName").value,
                email,
                password: document.getElementById("signupPassword").value,
                role: document.getElementById("signupRole").value
            }
        });
        pendingEmail = email;
        const label = document.getElementById("otpEmailLabel");
        if (label) label.textContent = email;
        e.target.reset();
        showToast("Verification code sent to your email.", "success");
        showSection("verify-otp");
        startResendCooldown(60);
    });
});

document.getElementById("otpForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        await api("/auth/verify-otp", {
            method: "POST",
            body: { email: pendingEmail, otp: document.getElementById("otpCode").value }
        });
        pendingEmail = null;
        e.target.reset();
        showToast("Email verified! Please sign in.", "success");
        showSection("login");
    });
});

document.getElementById("resendOtpBtn")?.addEventListener("click", async () => {
    if (!pendingEmail) return showSection("signup");
    try {
        await api("/auth/resend-otp", { method: "POST", body: { email: pendingEmail } });
        showToast("A fresh OTP code has been dispatched.", "success");
        startResendCooldown(60);
    } catch (err) {
        showToast(err.message, "error");
    }
});

/* ---------- Login & Logout ---------- */
document.getElementById("loginForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        await api("/auth/login", {
            method: "POST",
            body: {
                email: document.getElementById("loginEmail").value,
                password: document.getElementById("loginPassword").value
            }
        });
        e.target.reset();
        await refreshMe();
        showToast("Welcome back, " + me.name + "!", "success");
        showSection(me.role === "admin" ? "admin" : "profile");
    });
});

document.getElementById("logoutButton")?.addEventListener("click", async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch (e) { /* ignore */ }
    me = null;
    updateAuthUI();
    showToast("Signed out successfully.", "success");
    showSection("home");
});

/* ---------- Donor Registration ---------- */
document.getElementById("donorForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const result = await api("/donors", {
            method: "POST",
            body: {
                name: document.getElementById("donorName").value,
                age: document.getElementById("donorAge").value,
                bloodGroup: document.getElementById("bloodGroup").value,
                city: document.getElementById("donorCity").value,
                phone: document.getElementById("donorPhone").value,
                lastDonation: document.getElementById("lastDonation").value
            }
        });
        e.target.reset();
        showToast("Successfully registered as donor! ID: " + result.donorId, "success");
        showSection("profile");
    });
});

/* ---------- Modern Donor Card Rendering ---------- */
function renderDonorCards(list, boxId) {
    const box = document.getElementById(boxId);
    if (!box) return;
    if (list.length === 0) {
        box.innerHTML = `
            <div style="text-align:center; padding: 24px; color: var(--muted);">
                <span style="font-size:32px;">🔍</span>
                <p style="margin-top:8px; font-weight:600;">No donors found matching criteria.</p>
                <p style="font-size:13px;">Try choosing 'All Blood Groups' or neighbouring cities.</p>
            </div>`;
        return;
    }

    box.innerHTML = `
        <div style="margin-bottom:14px; font-size:13px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em;">
            Matching Donors Available (${list.length})
        </div>
        <div class="cards-grid">
            ${list.map(d => `
                <div class="donor-card">
                    <div class="donor-card-header">
                        <div>
                            <h4>${esc(d.name)}</h4>
                            <span class="donor-id">ID: ${esc(d.id)}</span>
                        </div>
                        <div class="blood-badge">${esc(d.bloodGroup)}</div>
                    </div>
                    <div class="donor-card-body">
                        <p class="donor-info">📍 <strong>${esc(d.city)}</strong> &nbsp;•&nbsp; Age:${esc(d.age)}</p>
                        <p class="donor-info">📞 ${d.phone ? `<a href="tel:${esc(d.phone)}" class="donor-phone">${esc(d.phone)}</a>` : '<span style="color:var(--muted); font-size:12px;">Login to view contact</span>'}</p>
                    </div>
                    <div class="donor-card-footer">
                        <span class="status ${d.available ? 'ok' : 'wait'}">
                            ${d.available ? '● Available to donate' : '○ Recently donated'}
                        </span>
                        ${d.phone ? `<a href="tel:${esc(d.phone)}" class="call-btn">Call Now</a>` : ''}
                    </div>
                </div>
            `).join("")}
        </div>
    `;
}

async function searchDonors() {
    const group = document.getElementById("searchBloodGroup")?.value || "";
    const city = document.getElementById("searchCity")?.value.trim() || "";
    const params = new URLSearchParams({ bloodGroup: group, city });
    renderDonorCards(await api("/donors?" + params.toString()), "searchResults");
}

document.getElementById("searchForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, searchDonors);
});

/* ---------- Blood Requests ---------- */
document.getElementById("requestForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const result = await api("/requests", {
            method: "POST",
            body: {
                patient: document.getElementById("reqPatient").value,
                bloodGroup: document.getElementById("reqGroup").value,
                units: document.getElementById("reqUnits").value,
                hospital: document.getElementById("reqHospital").value,
                city: document.getElementById("reqCity").value,
                phone: document.getElementById("reqPhone").value,
                neededBy: document.getElementById("reqDate").value,
                urgency: document.getElementById("reqUrgency").value
            }
        });
        e.target.reset();
        document.getElementById("reqUnits").value = 1;
        showToast(`${result.notified} donor(s) notified (${result.matched.length} matched).`, "success");
        showSection("my-requests");
    });
});

async function renderMyRequests() {
    const box = document.getElementById("myRequests");
    if (!box) return;
    const list = await api("/requests/mine");
    if (list.length === 0) {
        box.innerHTML = "<p style='color:var(--muted); padding:10px 0;'>No active blood requests created by you yet.</p>";
        return;
    }
    box.innerHTML = `<div class="cards-grid">` + list.map(r => {
        const donors = r.acceptedDonors.length
            ? r.acceptedDonors.map(d => `<div class="accepted-pill">✅ <strong>${esc(d.name)}</strong> accepted &nbsp;•&nbsp; 📞 <a href="tel:${esc(d.phone)}">${esc(d.phone)}</a></div>`).join("")
            : "<p style='color:var(--muted); font-size:13px; margin-top:8px;'>No donor has accepted yet. Network is matching...</p>";
        const closeBtn = (r.status === "Open" || r.status === "Accepted")
            ? `<button type="button" class="small secondary" style="margin-top:12px;" onclick="markFulfilled(${r.dbId})">Mark as Fulfilled</button>` : "";
        const urgent = r.urgency !== "Normal" ? `<span class="status wait">${esc(r.urgency)}</span>` : "";
        return `
        <div class="donor-card">
            <div class="donor-card-header">
                <div>
                    <h4>${esc(r.patient)}</h4>
                    <span class="donor-id">${esc(r.code)} ${urgent}</span>
                </div>
                <div class="blood-badge">${esc(r.bloodGroup)}</div>
            </div>
            <div class="donor-card-body">
                <p class="donor-info">🏥 <strong>${esc(r.hospital)}</strong>, ${esc(r.city)}</p>
                <p class="donor-info">🩸 Units: <strong>${esc(r.units)}</strong> &nbsp;•&nbsp; Needed: <strong>${esc(r.neededBy)}</strong></p>
                <div class="metrics-pill-row">
                    <span>Notified: ${r.counts.total}</span>
                    <span>Accepted: ${r.counts.accepted}</span>
                    <span>Declined: ${r.counts.declined}</span>
                </div>
                <div style="margin-top:10px;">${donors}</div>
            </div>
            <div class="donor-card-footer">
                <span class="status ok">${esc(r.status)}</span>
                ${closeBtn}
            </div>
        </div>`;
    }).join("") + `</div>`;
}

async function markFulfilled(id) {
    try {
        await api("/requests/" + id + "/fulfill", { method: "POST" });
        showToast("Request marked as fulfilled.", "success");
        await renderMyRequests();
    } catch (err) {
        showToast(err.message, "error");
    }
}

/* ---------- Emergency Alert Engine ---------- */
document.getElementById("emergencyForm")?.addEventListener("submit", e => {
    e.preventDefault();
    guarded(e.target, async () => {
        const result = await api("/requests", {
            method: "POST",
            body: {
                patient: "Emergency patient",
                bloodGroup: document.getElementById("emGroup").value,
                units: 1,
                hospital: document.getElementById("emHospital").value,
                city: document.getElementById("emCity").value,
                phone: document.getElementById("emPhone").value,
                urgency: "Emergency"
            }
        });
        renderDonorCards(result.matched, "emergencyResults");
        document.getElementById("emergencyResults").insertAdjacentHTML("afterbegin",
            `<div style="background:var(--light-red); border:1px solid var(--border-red); padding:14px; border-radius:var(--radius-md); margin-bottom:16px;">
                🚨 Emergency request <strong>${esc(result.code)}</strong> broadcasted to <strong>${result.notified}</strong> verified donor(s).
             </div>`);
        showToast("Emergency alert broadcasted!", "success");
    });
});

/* ---------- Notifications Inbox ---------- */
async function renderNotifications() {
    const box = document.getElementById("notificationList");
    if (!box) return;
    const list = await api("/notifications");
    if (list.length === 0) {
        box.innerHTML = "<p style='color:var(--muted); padding:10px 0;'>No emergency donation requests for you right now.</p>";
        return;
    }
    box.innerHTML = `<div class="cards-grid">` + list.map(n => {
        const r = n.request;
        const urgent = r.urgency !== "Normal" ? `<span class="status wait">${esc(r.urgency)}</span>` : "";
        const actions = n.status === "pending"
            ? `<div style="display:flex; gap:8px; margin-top:12px;">
                <button type="button" class="small" onclick="respondToNotification(${n.id},'accepted')">Accept to Donate</button>
                <button type="button" class="small secondary" onclick="respondToNotification(${n.id},'declined')">Decline</button>
               </div>`
            : "";
        const contact = r.phone ? `<p class="donor-info" style="margin-top:6px;">📞 Contact: <strong>${esc(r.phone)}</strong></p>` : "";
        return `
        <div class="donor-card">
            <div class="donor-card-header">
                <div>
                    <h4>${esc(r.patient)} needs ${esc(r.bloodGroup)} ${urgent}</h4>
                    <span class="donor-id">Required by ${esc(r.neededBy)}</span>
                </div>
                <div class="blood-badge">${esc(r.bloodGroup)}</div>
            </div>
            <div class="donor-card-body">
                <p class="donor-info">🏥 ${esc(r.hospital)}, ${esc(r.city)} &nbsp;•&nbsp; Units: ${esc(r.units)}</p>
                ${contact}
            </div>
            <div class="donor-card-footer">
                <span class="status ${n.status === 'accepted' ? 'ok' : 'wait'}">Status: ${esc(n.status)}</span>
                ${actions}
            </div>
        </div>`;
    }).join("") + `</div>`;
}

async function respondToNotification(id, status) {
    try {
        await api("/notifications/" + id + "/respond", { method: "POST", body: { status } });
        showToast(status === "accepted" ? "Thank you for saving a life!" : "Request declined.",
                  status === "accepted" ? "success" : "error");
        await refreshMe();
        await renderNotifications();
    } catch (err) {
        showToast(err.message, "error");
    }
}

/* ---------- Profile & History Views ---------- */
async function renderProfile() {
    const box = document.getElementById("profileDetails");
    if (!box) return;
    if (!me) {
        box.innerHTML = "<p>Please log in to view your profile.</p>";
        return;
    }
    let html = `
        <div class="profile-grid">
            <div class="profile-row"><span>Name</span><strong>${esc(me.name)}</strong></div>
            <div class="profile-row"><span>Email</span><strong>${esc(me.email)}</strong></div>
            <div class="profile-row"><span>Account Type</span><span class="status ok">${esc(ROLE_LABELS[me.role] || me.role)}</span></div>
        </div>`;
    
    if (me.role !== "admin") {
        const donors = await api("/donors/mine");
        if (donors.length === 0) {
            html += "<p style='margin-top:16px; color:var(--muted);'>You have not registered as an active donor yet.</p>";
        } else {
            donors.forEach(d => {
                html += `
                <h3 style="margin-top:24px; font-size:16px; border-bottom:1px solid var(--border); padding-bottom:8px;">Active Donor Registration</h3>
                <div class="profile-grid" style="margin-top:12px;">
                    <div class="profile-row"><span>Donor ID</span><strong>${esc(d.id)}</strong></div>
                    <div class="profile-row"><span>Blood Group</span><span class="blood-badge-inline">${esc(d.bloodGroup)}</span></div>
                    <div class="profile-row"><span>Location</span><strong>${esc(d.city)}</strong></div>
                    <div class="profile-row"><span>Contact</span><strong>${esc(d.phone)}</strong></div>
                    <div class="profile-row"><span>Availability</span><span class="status ${d.available ? 'ok' : 'wait'}">${d.available ? "Available" : "Recently donated"}</span></div>
                </div>`;
            });
        }
        html += `<button type="button" class="secondary" onclick="showSection('history')" style="margin-top:20px;">📜 View Donation History</button>`;
    }
    box.innerHTML = html;
}

async function renderHistory() {
    const box = document.getElementById("donationHistory");
    if (!box) return;
    if (!me) {
        box.innerHTML = "<p>Please log in to view your records.</p>";
        return;
    }
    const records = (await api("/donors/mine")).filter(d => d.lastDonation);
    if (records.length === 0) {
        box.innerHTML = "<p style='color:var(--muted); padding:10px 0;'>No prior donation dates recorded yet.</p>";
        return;
    }
    box.innerHTML = records.map(d => `
        <div class="donor-card">
            <div class="donor-card-header">
                <div>
                    <h4>Donation Recorded</h4>
                    <p class="donor-info">Donor ID: <strong>${esc(d.id)}</strong></p>
                    <p class="donor-info">Date: <strong>${esc(d.lastDonation)}</strong></p>
                </div>
                <div class="blood-badge">${esc(d.bloodGroup)}</div>
            </div>
        </div>`).join("");
}

/* ---------- Admin Control Panel ---------- */
/* ---------- Admin Dashboard & User Management ---------- */
async function renderAdmin() {
    const box = document.getElementById("adminContent");
    if (!box) return;

    box.innerHTML = `<p style="padding: 20px; color: var(--muted);">Loading dashboard data...</p>`;

    try {
        const data = await api("/admin/summary");

        const donorRows = data.donors.map(d => `
            <tr>
                <td><strong>${esc(d.id)}</strong></td>
                <td>${esc(d.name)}</td>
                <td><span class="blood-badge-inline">${esc(d.bloodGroup)}</span></td>
                <td>${esc(d.city)}</td>
                <td>${esc(d.phone)}</td>
                <td><span class="status ${d.available ? 'ok' : 'wait'}">${d.available ? "Available" : "Donated"}</span></td>
                <td><button type="button" class="small delete-btn" onclick="adminDelete('donors', ${d.dbId})">Remove</button></td>
            </tr>`).join("");

        const requestRows = data.requests.map(r => `
            <tr>
                <td><strong>${esc(r.code)}</strong></td>
                <td>${esc(r.patient)}</td>
                <td><span class="blood-badge-inline">${esc(r.bloodGroup)}</span></td>
                <td>${esc(r.city)}</td>
                <td><span class="status wait">${esc(r.urgency)}</span></td>
                <td><span class="status ok">${esc(r.status)}</span></td>
                <td><button type="button" class="small delete-btn" onclick="adminDelete('requests', ${r.dbId})">Remove</button></td>
            </tr>`).join("");

        const userRows = data.users.map(u => `
            <tr>
                <td><strong>${esc(u.name)}</strong></td>
                <td>${esc(u.email)}</td>
                <td><span class="status ok">${esc(ROLE_LABELS[u.role] || u.role)}</span></td>
                <td>
                    ${(me && u.email === me.email) 
                        ? '<span style="font-size: 11.5px; font-weight:700; color: #16a34a;">Active Admin</span>' 
                        : `<button type="button" class="small delete-btn" onclick="adminDelete('users', ${u.id})">Remove User</button>`}
                </td>
            </tr>`).join("");

        box.innerHTML = `
            <div class="stats" style="margin-bottom: 24px;">
                <div><h2>${data.users.length}</h2><p>Registered Users</p></div>
                <div><h2>${data.donors.length}</h2><p>Active Donors</p></div>
                <div><h2>${data.requests.length}</h2><p>Total Requests</p></div>
                <div><h2>${data.accepted}</h2><p>Accepted Lives Saved</p></div>
            </div>

            <h3 style="margin-top: 24px; font-size: 16px;">👥 Registered Users</h3>
            <div style="overflow-x:auto; margin-bottom: 24px;">
                <table>
                    <thead>
                        <tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr>
                    </thead>
                    <tbody>${userRows || "<tr><td colspan='4'>No users registered yet.</td></tr>"}</tbody>
                </table>
            </div>

            <h3 style="margin-top: 24px; font-size: 16px;">🩸 Registered Donors</h3>
            <div style="overflow-x:auto; margin-bottom: 24px;">
                <table>
                    <thead>
                        <tr><th>ID</th><th>Name</th><th>Group</th><th>City</th><th>Phone</th><th>Status</th><th>Action</th></tr>
                    </thead>
                    <tbody>${donorRows || "<tr><td colspan='7'>No donors found.</td></tr>"}</tbody>
                </table>
            </div>

            <h3 style="margin-top: 24px; font-size: 16px;">📢 Blood Requests</h3>
            <div style="overflow-x:auto;">
                <table>
                    <thead>
                        <tr><th>Code</th><th>Patient</th><th>Group</th><th>City</th><th>Urgency</th><th>Status</th><th>Action</th></tr>
                    </thead>
                    <tbody>${requestRows || "<tr><td colspan='7'>No requests logged.</td></tr>"}</tbody>
                </table>
            </div>
        `;
    } catch (err) {
        box.innerHTML = `<p style="color: #dc2626; padding: 20px;">⚠️ Error loading admin data: ${esc(err.message)}</p>`;
    }
}

async function adminDelete(kind, id) {
    const label = kind === 'users' ? 'user account' : (kind === 'donors' ? 'donor entry' : 'request');
    if (!confirm(`Are you sure you want to delete this ${label} permanently?`)) return;

    try {
        await api("/admin/" + kind + "/" + id, { method: "DELETE" });
        showToast("Record removed successfully.", "success");
        await renderAdmin();
    } catch (err) {
        showToast(err.message, "error");
    }
}

/* ---------- Startup ---------- */
(async function init() {
    const reqDate = document.getElementById("reqDate");
    if (reqDate) reqDate.min = new Date().toISOString().slice(0, 10);
    await refreshMe();
    showSection(location.hash.replace("#", "") || "home");
    setInterval(() => { if (me) refreshMe(); }, 30000);
})();