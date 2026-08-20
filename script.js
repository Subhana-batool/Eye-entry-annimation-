/**
 * VANTAGE — opening eye experience
 * -----------------------------------------------------------------------
 * Overview of the interaction, top to bottom:
 *   1. Pupil tracking   — a rAF loop lerps the pupil toward the pointer,
 *                          or toward a slow idle "wander" target when the
 *                          pointer is elsewhere / on touch devices.
 *   2. Hold-to-enter     — pointerdown starts a timer + a progress ring;
 *                          releasing early cancels and resets; holding for
 *                          HOLD_DURATION triggers a blink.
 *   3. Blink & transition— one CSS blink animation plays, then the eye
 *                          experience cross-fades into the placeholder site.
 *
 * To customise timing, see the CONFIG block just below — and keep
 * --hold-duration / --blink-duration in style.css in sync if you change
 * HOLD_DURATION or BLINK_DURATION here.
 * -----------------------------------------------------------------------
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // CONFIG — tweak these to change feel/timing
  // ---------------------------------------------------------------------
  const CONFIG = {
    HOLD_DURATION: 1700,      // ms the user must hold before the eye blinks (1.5–2s range)
    BLINK_DURATION: 420,      // ms — must match --blink-duration in style.css
    TRANSITION_DELAY: 120,    // ms pause after blink finishes, before the site fades in
    PUPIL_LERP: 0.16,         // 0–1, higher = pupil snaps faster to its target
    PUPIL_MAX_OFFSET: 24,     // viewBox units the pupil may travel from iris centre
    IDLE_RADIUS: 7,           // viewBox units of idle wander when pointer is inactive
    IDLE_INTERVAL: [2200, 4200], // ms range between idle target changes
    POINTER_IDLE_TIMEOUT: 900,   // ms of no pointer movement before we call it "inactive"
  };

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  // ---------------------------------------------------------------------
  // Element references
  // ---------------------------------------------------------------------
  const eyeExperience = document.getElementById("eyeExperience");
  const eyeStage = document.querySelector(".eye-stage");
  const eyeHit = document.getElementById("eyeHit");
  const eyeVisual = document.getElementById("eyeVisual");
  const pupilTrack = document.getElementById("pupilTrack");
  const progressRing = document.getElementById("progressRing");
  const skipEnter = document.getElementById("skipEnter");
  const site = document.getElementById("site");
  const siteHeading = document.getElementById("siteHeading");

  document.body.classList.add("is-locked");

  // ---------------------------------------------------------------------
  // Progress ring setup — trace its own length so the dash math is exact
  // regardless of the ellipse's radius.
  // ---------------------------------------------------------------------
  const ringLength = progressRing.getTotalLength();
  progressRing.style.strokeDasharray = String(ringLength);
  progressRing.style.strokeDashoffset = String(ringLength); // fully hidden at rest

  // ---------------------------------------------------------------------
  // 1. PUPIL TRACKING
  // A single rAF loop owns both the idle wander and the pointer-follow,
  // always moving the *current* position a fraction of the way toward
  // whatever the *target* position currently is — that's the smooth
  // interpolation (lerp) instead of an instant jump.
  // ---------------------------------------------------------------------
  let current = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  let idleTarget = { x: 0, y: 0 };
  let lastPointerMove = 0;
  let pointerIsDown = false;

  function scheduleIdleTarget() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * CONFIG.IDLE_RADIUS;
    idleTarget = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
    const [min, max] = CONFIG.IDLE_INTERVAL;
    const next = min + Math.random() * (max - min);
    setTimeout(scheduleIdleTarget, next);
  }
  if (!prefersReducedMotion) scheduleIdleTarget();

  function isPointerActive() {
    return performance.now() - lastPointerMove < CONFIG.POINTER_IDLE_TIMEOUT;
  }

  function updateTargetFromPointer(clientX, clientY) {
    lastPointerMove = performance.now();
    const rect = eyeHit.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy) || 1;

    // Pupil travels further the further the pointer sits from the eye's
    // centre, capped so it can never leave the iris.
    const pixelReach = Math.max(rect.width, rect.height);
    const magnitude = Math.min((dist / pixelReach) * CONFIG.PUPIL_MAX_OFFSET * 1.6, CONFIG.PUPIL_MAX_OFFSET);

    target = {
      x: (dx / dist) * magnitude,
      y: (dy / dist) * magnitude,
    };
  }

  function trackingLoop() {
    const useTarget = isPointerActive() ? target : idleTarget;
    current.x += (useTarget.x - current.x) * CONFIG.PUPIL_LERP;
    current.y += (useTarget.y - current.y) * CONFIG.PUPIL_LERP;

    pupilTrack.setAttribute(
      "transform",
      `translate(${current.x.toFixed(2)}, ${current.y.toFixed(2)})`
    );

    requestAnimationFrame(trackingLoop);
  }
  requestAnimationFrame(trackingLoop);

  window.addEventListener(
    "pointermove",
    (e) => updateTargetFromPointer(e.clientX, e.clientY),
    { passive: true }
  );

  // ---------------------------------------------------------------------
  // 2. HOLD-TO-ENTER
  // Pointer Events unify mouse + touch + pen, so the same handlers drive
  // desktop and mobile. touch-action:none (in CSS) plus preventDefault()
  // below stop the page from scrolling while the eye is being held.
  // ---------------------------------------------------------------------
  let holdStartTime = null;
  let holdRAF = null;
  let holdCompleted = false;
  let entered = false;

  function beginHold(e) {
    if (entered || holdStartTime !== null) return;
    // Only the primary mouse button / a genuine touch or pen contact.
    if (e.pointerType === "mouse" && e.button !== 0) return;

    pointerIsDown = true;
    holdStartTime = performance.now();
    holdCompleted = false;

    eyeHit.classList.remove("is-resetting");
    eyeHit.classList.add("is-holding");
    eyeStage.classList.add("is-active");

    try {
      eyeHit.setPointerCapture(e.pointerId);
    } catch (_) {
      /* older browsers / already released — safe to ignore */
    }

    updateTargetFromPointer(e.clientX, e.clientY);
    e.preventDefault(); // stop touch-scroll / text-selection from starting

    holdRAF = requestAnimationFrame(stepHold);
  }

  function stepHold() {
    if (holdStartTime === null) return;
    const elapsed = performance.now() - holdStartTime;
    const progress = Math.min(elapsed / CONFIG.HOLD_DURATION, 1);

    // Draw the ring open as the hold advances (1 = fully drawn / offset 0).
    progressRing.style.strokeDashoffset = String(ringLength * (1 - progress));

    if (progress >= 1) {
      completeHold();
      return;
    }
    holdRAF = requestAnimationFrame(stepHold);
  }

  function endHold() {
    if (holdCompleted || entered) return; // success already handled elsewhere
    if (holdStartTime === null) return;   // nothing was in progress

    cancelHold();
  }

  function cancelHold() {
    pointerIsDown = false;
    holdStartTime = null;
    if (holdRAF) cancelAnimationFrame(holdRAF);
    holdRAF = null;

    eyeHit.classList.remove("is-holding");
    eyeHit.classList.add("is-resetting");
    eyeStage.classList.remove("is-active");

    // Smoothly unwind the progress ring back to empty via CSS transition
    // (the class above adds `transition: opacity …`; dashoffset also
    // animates because it's a plain style property, not JS-stepped now).
    progressRing.style.transition = "stroke-dashoffset 380ms ease, opacity 380ms ease";
    progressRing.style.strokeDashoffset = String(ringLength);

    window.setTimeout(() => {
      eyeHit.classList.remove("is-resetting");
      progressRing.style.transition = "";
    }, 400);
  }

  function completeHold() {
    holdCompleted = true;
    holdStartTime = null;
    pointerIsDown = false;
    eyeHit.classList.remove("is-holding");
    eyeStage.classList.remove("is-active");
    progressRing.style.strokeDashoffset = "0";
    triggerBlinkThenEnter();
  }

  eyeHit.addEventListener("pointerdown", beginHold);
  eyeHit.addEventListener("pointerup", endHold);
  eyeHit.addEventListener("pointercancel", endHold);
  eyeHit.addEventListener("pointerleave", (e) => {
    // Only cancel on leave for touch/pen — for mouse, moving off the eye
    // mid-hold reads as an intentional release too, so treat it the same.
    endHold();
  });
  // Belt-and-braces: releasing anywhere on the page ends a hold.
  window.addEventListener("pointerup", endHold);
  window.addEventListener("blur", endHold);

  // Keyboard equivalent: focus the eye, hold Enter or Space.
  eyeHit.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
      beginHold({
        pointerType: "keyboard",
        pointerId: -1,
        clientX: eyeHit.getBoundingClientRect().left + eyeHit.offsetWidth / 2,
        clientY: eyeHit.getBoundingClientRect().top + eyeHit.offsetHeight / 2,
        preventDefault: () => e.preventDefault(),
      });
    }
  });
  eyeHit.addEventListener("keyup", (e) => {
    if (e.key === "Enter" || e.key === " ") endHold();
  });

  // Accessible bypass — skips the gesture entirely.
  skipEnter.addEventListener("click", (e) => {
    e.preventDefault();
    if (holdCompleted || entered) return;
    triggerBlinkThenEnter();
  });

  // ---------------------------------------------------------------------
  // 3. BLINK + TRANSITION
  // ---------------------------------------------------------------------
  function triggerBlinkThenEnter() {
    if (entered) return;

    if (prefersReducedMotion) {
      enterSite();
      return;
    }

    eyeVisual.classList.add("is-blinking");
    window.setTimeout(() => {
      enterSite();
    }, CONFIG.BLINK_DURATION + CONFIG.TRANSITION_DELAY);
  }

  function enterSite() {
    if (entered) return;
    entered = true;

    eyeExperience.classList.add("is-leaving");
    site.hidden = false;
    // Force layout so the browser registers `hidden` being removed before
    // the opacity transition to `is-visible` starts, so it actually animates.
    void site.offsetHeight;
    site.classList.add("is-visible");

    window.setTimeout(() => {
      eyeExperience.remove();
      document.body.classList.remove("is-locked");
      siteHeading.focus({ preventScroll: true }); // hand focus to the real page
    }, CONFIG.TRANSITION_DELAY + 1300);
  }
})();