import { GUI } from "dat.gui";
import { ViewModes } from "./render.js";

export class Controls {
  constructor(_canvas, simulator) {
    this.simulator = simulator;
    this._init_listeners();
    this._init_view_mode();
    this._init_file_input();
    this._init_aero_score();

    const resetButton = document.getElementById("resetSimButton");
    resetButton.addEventListener("click", () => {
      simulator.reset_simulation();
    });
    const rotateZBtn = document.getElementById("rotateZModelButton");
    rotateZBtn.addEventListener("click", () => {
      simulator.rotateModel90Z().catch((err) => console.error(err));
    });
    const rotateYBtn = document.getElementById("rotateYModelButton");
    rotateYBtn.addEventListener("click", () => {
      simulator.rotateModel90Y().catch((err) => console.error(err));
    });
    const rotateXBtn = document.getElementById("rotateXModelButton");
    rotateXBtn.addEventListener("click", () => {
      simulator.rotateModel90X().catch((err) => console.error(err));
    });
    this.displayBtn = document.getElementById("toggleDisplayModel");
    this.displayBtn.addEventListener("click", () => this._on_click_display_checkbox(false));
  }

  _init_aero_score() {
    // Aerodynamic slider
    const scoreIndicator = document.getElementById("score-indicator");
    const scoreValue = document.getElementById("score-value");

    this.simulator.add_score_listener((score) => {
      const clamped = Math.max(0, Math.min(1, score));
      const x = clamped * 100; // 0~100%
      scoreIndicator.style.left = `${x}%`;
      scoreValue.textContent = clamped.toFixed(2);
    });
  }

  _init_listeners() {
    window.addEventListener("keydown", (e) => this._on_KeyDown(e));
  }

  _init_file_input() {
    const fileInput = document.getElementById("meshFileInput");

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const ext = file.name.split(".").pop().toLowerCase();
      if (!["xml", "ply", "obj"].includes(ext)) {
        alert("Supported formats: .xml, .ply, .obj");
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      try {
        await this.simulator.loadModel(objectUrl, ext);
        this.simulator.reset_simulation();
      } catch (err) {
        console.error(err);
        alert("Failed to load mesh.");
      }
    });
  }

  _on_click_display_checkbox(toggle) {
    if (toggle) {
      this.displayBtn.checked = (!this.displayBtn.checked);
    }
    this.simulator.set_display_visible(this.displayBtn.checked);
  }

  _on_click_mode_button(btn) {
    // "velocity" | "pressure" | "obstacle" | "dye"
    const mode = btn.dataset.mode;

    // Remove all highlights but around the clicked button
    this.modeButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    this.simulator.set_view_mode(mode);
  }

  _init_view_mode() {
    this.modeButtons = document.querySelectorAll(".mode-button");
    this.modeButtons.forEach((btn) => {
      btn.addEventListener("click", () => this._on_click_mode_button(btn));
    });
    this.velocityBtn = document.querySelector('[data-mode="velocity"]');
    this.pressureBtn = document.querySelector('[data-mode="pressure"]');
    this.obstacleBtn = document.querySelector('[data-mode="obstacle"]');
    this.dyecolorBtn = document.querySelector('[data-mode="dye"]');
  }

  _on_toggle_simulator(e) {
    if (this.simulator.isRunning()) {
      this.simulator.stop();
    } else {
      this.simulator.start();
    }
    e.preventDefault();
  }

  _on_KeyDown(e) {
    switch (e.code) {
      // Rotation keys: ←(+90Y), →(-90Y), ↑(-90Z), ↓(+90Z)
      case "Comma": case "KeyX":
        return this.simulator.rotateModel90X();
      case "ArrowLeft": case "Period": case "KeyY":
        return this.simulator.rotateModel90Y();
      case "ArrowRight":
        return this.simulator.rotateModel90Y(-1);
      case "ArrowUp":
        return this.simulator.rotateModel90Z(-1);;
      case "Slash": case "ArrowDown": case "KeyZ":
        return this.simulator.rotateModel90Z();

      // Simulation control
      case "Space":
        return this._on_toggle_simulator(e);
      case "KeyR":
        return this.simulator.reset_simulation();

      // View/mode control
      case "KeyV":
        return this._on_click_mode_button(this.velocityBtn);
      case "KeyB": case "KeyP":
        return this._on_click_mode_button(this.pressureBtn);
      case "KeyN": case "KeyO":
        return this._on_click_mode_button(this.obstacleBtn);
      case "KeyM": case "KeyD":
        return this._on_click_mode_button(this.dyecolorBtn);
      case "KeyH":
        return this._on_click_display_checkbox(true);

      default:
        break;
    }
  }
}
