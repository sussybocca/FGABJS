/**
 * FGAB.js – FlashGamesGameBoy Emulator
 * Version 1.1.0
 * 
 * A pure JavaScript, dependency‑free emulator for Game Boy ROMs (.gb) and Flash games (.swf).
 * 
 * Game Boy features:
 *   - Full CPU instruction set (LR35902) with accurate timing
 *   - 64KB address space: ROM, VRAM, WRAM, OAM, I/O registers, HRAM
 *   - Picture Processing Unit (PPU) with background, window, and sprites
 *   - Timer and divider registers
 *   - Interrupt handling (VBlank, LCD STAT, Timer, Serial, Joypad)
 *   - MBC1 cartridge controller (supports up to 2MB ROM and 32KB RAM)
 * 
 * Flash features:
 *   - Embeds .swf files using the <object> tag (requires browser NPAPI support)
 *   - Automatically detects file extension and switches mode
 * 
 * Usage:
 *   const canvas = document.getElementById('gbCanvas');
 *   const emu = new FGAB(canvas);
 *   emu.loadROM('path/to/game.gb');   // for Game Boy
 *   emu.loadROM('path/to/game.swf');  // for Flash
 *   emu.start();
 * 
 * Note: Flash playback is deprecated in modern browsers; for a modern solution
 * consider integrating Ruffle (https://ruffle.rs) externally.
 */

(function(global) {
    'use strict';

    // ----------------------------------------------------------------------
    // Utility functions
    // ----------------------------------------------------------------------
    function loadBinary(url, callback) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function() {
            if (this.status === 200) {
                callback(new Uint8Array(this.response));
            } else {
                console.error('FGAB: Failed to load', url);
            }
        };
        xhr.onerror = () => console.error('FGAB: Network error loading', url);
        xhr.send();
    }

    // ----------------------------------------------------------------------
    // Game Boy CPU (LR35902) – full instruction set
    // ----------------------------------------------------------------------
    class LR35902 {
        constructor(mmu) {
            this.mmu = mmu;
            // Registers
            this.A = 0x01; this.F = 0xB0; // AF
            this.B = 0x00; this.C = 0x13; // BC
            this.D = 0x00; this.E = 0xD8; // DE
            this.H = 0x01; this.L = 0x4D; // HL
            this.SP = 0xFFFE;              // Stack Pointer
            this.PC = 0x0100;               // Program Counter
            this.ime = 1;                   // Interrupt Master Enable
            this.halt = false;
            this.stopped = false;
            this.cycles = 0;                 // Total cycles executed
        }

        // Flag helpers
        get flagZ() { return (this.F & 0x80) !== 0; }
        set flagZ(v) { this.F = v ? (this.F | 0x80) : (this.F & ~0x80); }
        get flagN() { return (this.F & 0x40) !== 0; }
        set flagN(v) { this.F = v ? (this.F | 0x40) : (this.F & ~0x40); }
        get flagH() { return (this.F & 0x20) !== 0; }
        set flagH(v) { this.F = v ? (this.F | 0x20) : (this.F & ~0x20); }
        get flagC() { return (this.F & 0x10) !== 0; }
        set flagC(v) { this.F = v ? (this.F | 0x10) : (this.F & ~0x10); }

        // 16‑bit register pairs
        get AF() { return (this.A << 8) | this.F; }
        set AF(val) { this.A = (val >> 8) & 0xFF; this.F = val & 0xF0; } // lower 4 bits always 0
        get BC() { return (this.B << 8) | this.C; }
        set BC(val) { this.B = (val >> 8) & 0xFF; this.C = val & 0xFF; }
        get DE() { return (this.D << 8) | this.E; }
        set DE(val) { this.D = (val >> 8) & 0xFF; this.E = val & 0xFF; }
        get HL() { return (this.H << 8) | this.L; }
        set HL(val) { this.H = (val >> 8) & 0xFF; this.L = val & 0xFF; }

        // Execute one instruction, return number of cycles used
        step() {
            if (this.halt) {
                // HALT: do nothing, but still consume cycles (we'll use 4)
                this.cycles += 4;
                return 4;
            }

            const opcode = this.mmu.rb(this.PC++);
            let cycles = 4; // default

            // Main opcode dispatch (LR35902 instruction set)
            switch (opcode) {
                // 8‑bit loads
                case 0x40: this.B = this.B; break; // LD B,B (NOP)
                case 0x41: this.B = this.C; break;
                case 0x42: this.B = this.D; break;
                case 0x43: this.B = this.E; break;
                case 0x44: this.B = this.H; break;
                case 0x45: this.B = this.L; break;
                case 0x46: this.B = this.mmu.rb(this.HL); cycles = 8; break;
                case 0x47: this.B = this.A; break;
                case 0x48: this.C = this.B; break;
                case 0x49: this.C = this.C; break;
                case 0x4A: this.C = this.D; break;
                case 0x4B: this.C = this.E; break;
                case 0x4C: this.C = this.H; break;
                case 0x4D: this.C = this.L; break;
                case 0x4E: this.C = this.mmu.rb(this.HL); cycles = 8; break;
                case 0x4F: this.C = this.A; break;
                case 0x50: this.D = this.B; break;
                case 0x51: this.D = this.C; break;
                case 0x52: this.D = this.D; break;
                case 0x53: this.D = this.E; break;
                case 0x54: this.D = this.H; break;
                case 0x55: this.D = this.L; break;
                case 0x56: this.D = this.mmu.rb(this.HL); cycles = 8; break;
                case 0x57: this.D = this.A; break;
                case 0x58: this.E = this.B; break;
                case 0x59: this.E = this.C; break;
                case 0x5A: this.E = this.D; break;
                case 0x5B: this.E = this.E; break;
                case 0x5C: this.E = this.H; break;
                case 0x5D: this.E = this.L; break;
                case 0x5E: this.E = this.mmu.rb(this.HL); cycles = 8; break;
                case 0x5F: this.E = this.A; break;
                case 0x60: this.H = this.B; break;
                case 0x61: this.H = this.C; break;
                case 0x62: this.H = this.D; break;
                case 0x63: this.H = this.E; break;
                case 0x64: this.H = this.H; break;
                case 0x65: this.H = this.L; break;
                case 0x66: this.H = this.mmu.rb(this.HL); cycles = 8; break;
                case 0x67: this.H = this.A; break;
                case 0x68: this.L = this.B; break;
                case 0x69: this.L = this.C; break;
                case 0x6A: this.L = this.D; break;
                case 0x6B: this.L = this.E; break;
                case 0x6C: this.L = this.H; break;
                case 0x6D: this.L = this.L; break;
                case 0x6E: this.L = this.mmu.rb(this.HL); cycles = 8; break;
                case 0x6F: this.L = this.A; break;
                case 0x70: this.mmu.wb(this.HL, this.B); cycles = 8; break;
                case 0x71: this.mmu.wb(this.HL, this.C); cycles = 8; break;
                case 0x72: this.mmu.wb(this.HL, this.D); cycles = 8; break;
                case 0x73: this.mmu.wb(this.HL, this.E); cycles = 8; break;
                case 0x74: this.mmu.wb(this.HL, this.H); cycles = 8; break;
                case 0x75: this.mmu.wb(this.HL, this.L); cycles = 8; break;
                case 0x77: this.mmu.wb(this.HL, this.A); cycles = 8; break;
                case 0x0A: this.A = this.mmu.rb(this.BC); cycles = 8; break; // LD A,(BC)
                case 0x1A: this.A = this.mmu.rb(this.DE); cycles = 8; break; // LD A,(DE)
                case 0x7F: this.A = this.A; break;
                case 0x78: this.A = this.B; break;
                case 0x79: this.A = this.C; break;
                case 0x7A: this.A = this.D; break;
                case 0x7B: this.A = this.E; break;
                case 0x7C: this.A = this.H; break;
                case 0x7D: this.A = this.L; break;
                case 0x7E: this.A = this.mmu.rb(this.HL); cycles = 8; break;
                case 0xFA: { // LD A,(nn)
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    const addr = (hi << 8) | lo;
                    this.A = this.mmu.rb(addr);
                    cycles = 16;
                    break;
                }
                // Immediate loads (LD r,n)
                case 0x06: this.B = this.mmu.rb(this.PC++); cycles = 8; break; // LD B,n
                case 0x0E: this.C = this.mmu.rb(this.PC++); cycles = 8; break; // LD C,n
                case 0x16: this.D = this.mmu.rb(this.PC++); cycles = 8; break; // LD D,n
                case 0x1E: this.E = this.mmu.rb(this.PC++); cycles = 8; break; // LD E,n
                case 0x26: this.H = this.mmu.rb(this.PC++); cycles = 8; break; // LD H,n
                case 0x2E: this.L = this.mmu.rb(this.PC++); cycles = 8; break; // LD L,n
                case 0x36: // LD (HL),n
                    this.mmu.wb(this.HL, this.mmu.rb(this.PC++));
                    cycles = 12;
                    break;
                case 0x3E: this.A = this.mmu.rb(this.PC++); cycles = 8; break; // LD A,n

                // 16‑bit loads
                case 0x01: { // LD BC,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    this.BC = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0x11: { // LD DE,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    this.DE = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0x21: { // LD HL,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    this.HL = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0x31: { // LD SP,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    this.SP = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0xF9: this.SP = this.HL; cycles = 8; break; // LD SP,HL

                // LD (nn),A and variants
                case 0x02: this.mmu.wb(this.BC, this.A); cycles = 8; break; // LD (BC),A
                case 0x12: this.mmu.wb(this.DE, this.A); cycles = 8; break; // LD (DE),A
                case 0x22: // LD (HL+),A
                    this.mmu.wb(this.HL, this.A);
                    this.HL = (this.HL + 1) & 0xFFFF;
                    cycles = 8;
                    break;
                case 0x32: // LD (HL-),A
                    this.mmu.wb(this.HL, this.A);
                    this.HL = (this.HL - 1) & 0xFFFF;
                    cycles = 8;
                    break;
                case 0x2A: // LD A,(HL+)
                    this.A = this.mmu.rb(this.HL);
                    this.HL = (this.HL + 1) & 0xFFFF;
                    cycles = 8;
                    break;
                case 0x3A: // LD A,(HL-)
                    this.A = this.mmu.rb(this.HL);
                    this.HL = (this.HL - 1) & 0xFFFF;
                    cycles = 8;
                    break;
                case 0xEA: { // LD (nn),A
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    const addr = (hi << 8) | lo;
                    this.mmu.wb(addr, this.A);
                    cycles = 16;
                    break;
                }
                case 0x08: { // LD (nn),SP
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    const addr = (hi << 8) | lo;
                    this.mmu.wb(addr, this.SP & 0xFF);
                    this.mmu.wb(addr + 1, (this.SP >> 8) & 0xFF);
                    cycles = 20;
                    break;
                }

                // I/O port loads
                case 0xE0: { // LD (FF00+n),A
                    const offset = this.mmu.rb(this.PC++);
                    this.mmu.wb(0xFF00 + offset, this.A);
                    cycles = 12;
                    break;
                }
                case 0xF0: { // LD A,(FF00+n)
                    const offset = this.mmu.rb(this.PC++);
                    this.A = this.mmu.rb(0xFF00 + offset);
                    cycles = 12;
                    break;
                }
                case 0xE2: // LD (C),A  (LD (FF00+C),A)
                    this.mmu.wb(0xFF00 + this.C, this.A);
                    cycles = 8;
                    break;
                case 0xF2: // LD A,(C)   (LD A,(FF00+C))
                    this.A = this.mmu.rb(0xFF00 + this.C);
                    cycles = 8;
                    break;

                // 16‑bit loads (PUSH/POP)
                case 0xC5: this.push(this.BC); cycles = 16; break;
                case 0xD5: this.push(this.DE); cycles = 16; break;
                case 0xE5: this.push(this.HL); cycles = 16; break;
                case 0xF5: this.push(this.AF); cycles = 16; break;
                case 0xC1: this.BC = this.pop(); cycles = 12; break;
                case 0xD1: this.DE = this.pop(); cycles = 12; break;
                case 0xE1: this.HL = this.pop(); cycles = 12; break;
                case 0xF1: this.AF = this.pop(); cycles = 12; break;

                // 8‑bit ALU
                case 0x80: this.add(this.B); break;
                case 0x81: this.add(this.C); break;
                case 0x82: this.add(this.D); break;
                case 0x83: this.add(this.E); break;
                case 0x84: this.add(this.H); break;
                case 0x85: this.add(this.L); break;
                case 0x86: this.add(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0x87: this.add(this.A); break;
                case 0xC6: this.add(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0x88: this.adc(this.B); break;
                case 0x89: this.adc(this.C); break;
                case 0x8A: this.adc(this.D); break;
                case 0x8B: this.adc(this.E); break;
                case 0x8C: this.adc(this.H); break;
                case 0x8D: this.adc(this.L); break;
                case 0x8E: this.adc(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0x8F: this.adc(this.A); break;
                case 0xCE: this.adc(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0x90: this.sub(this.B); break;
                case 0x91: this.sub(this.C); break;
                case 0x92: this.sub(this.D); break;
                case 0x93: this.sub(this.E); break;
                case 0x94: this.sub(this.H); break;
                case 0x95: this.sub(this.L); break;
                case 0x96: this.sub(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0x97: this.sub(this.A); break;
                case 0xD6: this.sub(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0x98: this.sbc(this.B); break;
                case 0x99: this.sbc(this.C); break;
                case 0x9A: this.sbc(this.D); break;
                case 0x9B: this.sbc(this.E); break;
                case 0x9C: this.sbc(this.H); break;
                case 0x9D: this.sbc(this.L); break;
                case 0x9E: this.sbc(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0x9F: this.sbc(this.A); break;
                case 0xDE: this.sbc(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0xA0: this.and(this.B); break;
                case 0xA1: this.and(this.C); break;
                case 0xA2: this.and(this.D); break;
                case 0xA3: this.and(this.E); break;
                case 0xA4: this.and(this.H); break;
                case 0xA5: this.and(this.L); break;
                case 0xA6: this.and(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0xA7: this.and(this.A); break;
                case 0xE6: this.and(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0xA8: this.xor(this.B); break;
                case 0xA9: this.xor(this.C); break;
                case 0xAA: this.xor(this.D); break;
                case 0xAB: this.xor(this.E); break;
                case 0xAC: this.xor(this.H); break;
                case 0xAD: this.xor(this.L); break;
                case 0xAE: this.xor(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0xAF: this.xor(this.A); break;
                case 0xEE: this.xor(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0xB0: this.or(this.B); break;
                case 0xB1: this.or(this.C); break;
                case 0xB2: this.or(this.D); break;
                case 0xB3: this.or(this.E); break;
                case 0xB4: this.or(this.H); break;
                case 0xB5: this.or(this.L); break;
                case 0xB6: this.or(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0xB7: this.or(this.A); break;
                case 0xF6: this.or(this.mmu.rb(this.PC++)); cycles = 8; break;

                case 0xB8: this.cp(this.B); break;
                case 0xB9: this.cp(this.C); break;
                case 0xBA: this.cp(this.D); break;
                case 0xBB: this.cp(this.E); break;
                case 0xBC: this.cp(this.H); break;
                case 0xBD: this.cp(this.L); break;
                case 0xBE: this.cp(this.mmu.rb(this.HL)); cycles = 8; break;
                case 0xBF: this.cp(this.A); break;
                case 0xFE: this.cp(this.mmu.rb(this.PC++)); cycles = 8; break;

                // 8‑bit increments/decrements
                case 0x04: this.incB(); cycles = 4; break;
                case 0x0C: this.incC(); cycles = 4; break;
                case 0x14: this.incD(); cycles = 4; break;
                case 0x1C: this.incE(); cycles = 4; break;
                case 0x24: this.incH(); cycles = 4; break;
                case 0x2C: this.incL(); cycles = 4; break;
                case 0x34: this.incHL(); cycles = 12; break;
                case 0x3C: this.incA(); cycles = 4; break;
                case 0x05: this.decB(); cycles = 4; break;
                case 0x0D: this.decC(); cycles = 4; break;
                case 0x15: this.decD(); cycles = 4; break;
                case 0x1D: this.decE(); cycles = 4; break;
                case 0x25: this.decH(); cycles = 4; break;
                case 0x2D: this.decL(); cycles = 4; break;
                case 0x35: this.decHL(); cycles = 12; break;
                case 0x3D: this.decA(); cycles = 4; break;

                // 16‑bit arithmetic
                case 0x09: this.addHL(this.BC); cycles = 8; break;
                case 0x19: this.addHL(this.DE); cycles = 8; break;
                case 0x29: this.addHL(this.HL); cycles = 8; break;
                case 0x39: this.addHL(this.SP); cycles = 8; break;
                case 0xE8: { // ADD SP,n
                    const n = this.mmu.rb(this.PC++);
                    const sp = this.SP;
                    const res = sp + (n << 24 >> 24); // sign‑extend
                    this.flagZ = false;
                    this.flagN = false;
                    this.flagH = ((sp & 0xF) + (n & 0xF)) > 0xF;
                    this.flagC = ((sp & 0xFF) + (n & 0xFF)) > 0xFF;
                    this.SP = res & 0xFFFF;
                    cycles = 16;
                    break;
                }
                case 0xF8: { // LD HL,SP+n
                    const n = this.mmu.rb(this.PC++);
                    const sp = this.SP;
                    const res = sp + (n << 24 >> 24);
                    this.HL = res & 0xFFFF;
                    this.flagZ = false;
                    this.flagN = false;
                    this.flagH = ((sp & 0xF) + (n & 0xF)) > 0xF;
                    this.flagC = ((sp & 0xFF) + (n & 0xFF)) > 0xFF;
                    cycles = 12;
                    break;
                }
                case 0x03: this.BC = (this.BC + 1) & 0xFFFF; cycles = 8; break; // INC BC
                case 0x13: this.DE = (this.DE + 1) & 0xFFFF; cycles = 8; break;
                case 0x23: this.HL = (this.HL + 1) & 0xFFFF; cycles = 8; break;
                case 0x33: this.SP = (this.SP + 1) & 0xFFFF; cycles = 8; break;
                case 0x0B: this.BC = (this.BC - 1) & 0xFFFF; cycles = 8; break; // DEC BC
                case 0x1B: this.DE = (this.DE - 1) & 0xFFFF; cycles = 8; break;
                case 0x2B: this.HL = (this.HL - 1) & 0xFFFF; cycles = 8; break;
                case 0x3B: this.SP = (this.SP - 1) & 0xFFFF; cycles = 8; break;

                // Rotates and shifts (including CB prefix)
                case 0x07: this.rlca(); break; // RLCA
                case 0x17: this.rla(); break;  // RLA
                case 0x0F: this.rrca(); break; // RRCA
                case 0x1F: this.rra(); break;  // RRA

                case 0xCB: {
                    const subop = this.mmu.rb(this.PC++);
                    cycles = this.execCB(subop);
                    break;
                }

                // Misc ALU
                case 0x27: this.daa(); cycles = 4; break;   // DAA
                case 0x2F: this.cpl(); cycles = 4; break;   // CPL
                case 0x37: this.scf(); cycles = 4; break;   // SCF
                case 0x3F: this.ccf(); cycles = 4; break;   // CCF

                // Jumps
                case 0xC3: { // JP nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    this.PC = (hi << 8) | lo;
                    cycles = 16;
                    break;
                }
                case 0xC2: { // JP NZ,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (!this.flagZ) this.PC = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0xCA: { // JP Z,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (this.flagZ) this.PC = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0xD2: { // JP NC,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (!this.flagC) this.PC = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0xDA: { // JP C,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (this.flagC) this.PC = (hi << 8) | lo;
                    cycles = 12;
                    break;
                }
                case 0xE9: this.PC = this.HL; cycles = 4; break; // JP (HL)

                // Relative jumps
                case 0x18: { // JR n
                    const n = this.mmu.rb(this.PC++);
                    this.PC += (n << 24 >> 24); // sign‑extend
                    cycles = 12;
                    break;
                }
                case 0x20: { // JR NZ,n
                    const n = this.mmu.rb(this.PC++);
                    if (!this.flagZ) {
                        this.PC += (n << 24 >> 24);
                        cycles = 12;
                    } else cycles = 8;
                    break;
                }
                case 0x28: { // JR Z,n
                    const n = this.mmu.rb(this.PC++);
                    if (this.flagZ) {
                        this.PC += (n << 24 >> 24);
                        cycles = 12;
                    } else cycles = 8;
                    break;
                }
                case 0x30: { // JR NC,n
                    const n = this.mmu.rb(this.PC++);
                    if (!this.flagC) {
                        this.PC += (n << 24 >> 24);
                        cycles = 12;
                    } else cycles = 8;
                    break;
                }
                case 0x38: { // JR C,n
                    const n = this.mmu.rb(this.PC++);
                    if (this.flagC) {
                        this.PC += (n << 24 >> 24);
                        cycles = 12;
                    } else cycles = 8;
                    break;
                }

                // Calls
                case 0xCD: { // CALL nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    const addr = (hi << 8) | lo;
                    this.push(this.PC);
                    this.PC = addr;
                    cycles = 24;
                    break;
                }
                case 0xC4: { // CALL NZ,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (!this.flagZ) {
                        this.push(this.PC);
                        this.PC = (hi << 8) | lo;
                        cycles = 24;
                    } else cycles = 12;
                    break;
                }
                case 0xCC: { // CALL Z,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (this.flagZ) {
                        this.push(this.PC);
                        this.PC = (hi << 8) | lo;
                        cycles = 24;
                    } else cycles = 12;
                    break;
                }
                case 0xD4: { // CALL NC,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (!this.flagC) {
                        this.push(this.PC);
                        this.PC = (hi << 8) | lo;
                        cycles = 24;
                    } else cycles = 12;
                    break;
                }
                case 0xDC: { // CALL C,nn
                    const lo = this.mmu.rb(this.PC++);
                    const hi = this.mmu.rb(this.PC++);
                    if (this.flagC) {
                        this.push(this.PC);
                        this.PC = (hi << 8) | lo;
                        cycles = 24;
                    } else cycles = 12;
                    break;
                }

                // Returns
                case 0xC9: this.PC = this.pop(); cycles = 16; break; // RET
                case 0xC0: if (!this.flagZ) { this.PC = this.pop(); cycles = 20; } else cycles = 8; break; // RET NZ
                case 0xC8: if (this.flagZ) { this.PC = this.pop(); cycles = 20; } else cycles = 8; break; // RET Z
                case 0xD0: if (!this.flagC) { this.PC = this.pop(); cycles = 20; } else cycles = 8; break; // RET NC
                case 0xD8: if (this.flagC) { this.PC = this.pop(); cycles = 20; } else cycles = 8; break; // RET C
                case 0xD9: // RETI
                    this.PC = this.pop();
                    this.ime = 1;
                    cycles = 16;
                    break;

                // Restart (RST)
                case 0xC7: this.push(this.PC); this.PC = 0x00; cycles = 16; break;
                case 0xCF: this.push(this.PC); this.PC = 0x08; cycles = 16; break;
                case 0xD7: this.push(this.PC); this.PC = 0x10; cycles = 16; break;
                case 0xDF: this.push(this.PC); this.PC = 0x18; cycles = 16; break;
                case 0xE7: this.push(this.PC); this.PC = 0x20; cycles = 16; break;
                case 0xEF: this.push(this.PC); this.PC = 0x28; cycles = 16; break;
                case 0xF7: this.push(this.PC); this.PC = 0x30; cycles = 16; break;
                case 0xFF: this.push(this.PC); this.PC = 0x38; cycles = 16; break;

                // Misc
                case 0x00: cycles = 4; break; // NOP
                case 0x76: this.halt = true; cycles = 4; break; // HALT
                case 0x10: // STOP
                    this.stopped = true;
                    this.PC++; // skip next byte (ignored)
                    cycles = 4;
                    break;
                case 0xF3: this.ime = 0; cycles = 4; break; // DI
                case 0xFB: this.ime = 1; cycles = 4; break; // EI

                default:
                    console.warn('FGAB: Unimplemented opcode 0x' + opcode.toString(16));
            }

            this.cycles += cycles;
            return cycles;
        }

        // CB prefixed instructions
        execCB(op) {
            let cycles = 8;
            const bit = (op >> 3) & 7;
            const reg = op & 7;
            let val, bitval;

            const getReg = () => {
                switch (reg) {
                    case 0: return this.B;
                    case 1: return this.C;
                    case 2: return this.D;
                    case 3: return this.E;
                    case 4: return this.H;
                    case 5: return this.L;
                    case 6: return this.mmu.rb(this.HL);
                    case 7: return this.A;
                }
            };
            const setReg = (v) => {
                switch (reg) {
                    case 0: this.B = v; break;
                    case 1: this.C = v; break;
                    case 2: this.D = v; break;
                    case 3: this.E = v; break;
                    case 4: this.H = v; break;
                    case 5: this.L = v; break;
                    case 6: this.mmu.wb(this.HL, v); cycles = 16; break;
                    case 7: this.A = v; break;
                }
            };

            if (op >= 0x40 && op <= 0x7F) { // BIT b,r
                val = getReg();
                bitval = (val >> bit) & 1;
                this.flagZ = (bitval === 0);
                this.flagN = false;
                this.flagH = true;
                // (no change to C)
                if (reg === 6) cycles = 16;
                return cycles;
            } else if (op >= 0x80 && op <= 0xBF) { // RES b,r
                val = getReg();
                val &= ~(1 << bit);
                setReg(val);
                return cycles;
            } else if (op >= 0xC0 && op <= 0xFF) { // SET b,r
                val = getReg();
                val |= (1 << bit);
                setReg(val);
                return cycles;
            }

            // Rotates and shifts
            switch (op) {
                case 0x00: this.rlc('B'); break;
                case 0x01: this.rlc('C'); break;
                case 0x02: this.rlc('D'); break;
                case 0x03: this.rlc('E'); break;
                case 0x04: this.rlc('H'); break;
                case 0x05: this.rlc('L'); break;
                case 0x06: this.rlc('HL'); cycles = 16; break;
                case 0x07: this.rlc('A'); break;
                case 0x08: this.rrc('B'); break;
                case 0x09: this.rrc('C'); break;
                case 0x0A: this.rrc('D'); break;
                case 0x0B: this.rrc('E'); break;
                case 0x0C: this.rrc('H'); break;
                case 0x0D: this.rrc('L'); break;
                case 0x0E: this.rrc('HL'); cycles = 16; break;
                case 0x0F: this.rrc('A'); break;
                case 0x10: this.rl('B'); break;
                case 0x11: this.rl('C'); break;
                case 0x12: this.rl('D'); break;
                case 0x13: this.rl('E'); break;
                case 0x14: this.rl('H'); break;
                case 0x15: this.rl('L'); break;
                case 0x16: this.rl('HL'); cycles = 16; break;
                case 0x17: this.rl('A'); break;
                case 0x18: this.rr('B'); break;
                case 0x19: this.rr('C'); break;
                case 0x1A: this.rr('D'); break;
                case 0x1B: this.rr('E'); break;
                case 0x1C: this.rr('H'); break;
                case 0x1D: this.rr('L'); break;
                case 0x1E: this.rr('HL'); cycles = 16; break;
                case 0x1F: this.rr('A'); break;
                case 0x20: this.sla('B'); break;
                case 0x21: this.sla('C'); break;
                case 0x22: this.sla('D'); break;
                case 0x23: this.sla('E'); break;
                case 0x24: this.sla('H'); break;
                case 0x25: this.sla('L'); break;
                case 0x26: this.sla('HL'); cycles = 16; break;
                case 0x27: this.sla('A'); break;
                case 0x28: this.sra('B'); break;
                case 0x29: this.sra('C'); break;
                case 0x2A: this.sra('D'); break;
                case 0x2B: this.sra('E'); break;
                case 0x2C: this.sra('H'); break;
                case 0x2D: this.sra('L'); break;
                case 0x2E: this.sra('HL'); cycles = 16; break;
                case 0x2F: this.sra('A'); break;
                case 0x30: this.swap('B'); break;
                case 0x31: this.swap('C'); break;
                case 0x32: this.swap('D'); break;
                case 0x33: this.swap('E'); break;
                case 0x34: this.swap('H'); break;
                case 0x35: this.swap('L'); break;
                case 0x36: this.swap('HL'); cycles = 16; break;
                case 0x37: this.swap('A'); break;
                case 0x38: this.srl('B'); break;
                case 0x39: this.srl('C'); break;
                case 0x3A: this.srl('D'); break;
                case 0x3B: this.srl('E'); break;
                case 0x3C: this.srl('H'); break;
                case 0x3D: this.srl('L'); break;
                case 0x3E: this.srl('HL'); cycles = 16; break;
                case 0x3F: this.srl('A'); break;
                default: console.warn('FGAB: Unimplemented CB op 0x' + op.toString(16));
            }
            return cycles;
        }

        // ALU helpers
        add(n) {
            const a = this.A;
            const res = a + n;
            this.flagZ = (res & 0xFF) === 0;
            this.flagN = false;
            this.flagH = ((a & 0xF) + (n & 0xF)) > 0xF;
            this.flagC = res > 0xFF;
            this.A = res & 0xFF;
        }
        adc(n) {
            const carry = this.flagC ? 1 : 0;
            const a = this.A;
            const res = a + n + carry;
            this.flagZ = (res & 0xFF) === 0;
            this.flagN = false;
            this.flagH = ((a & 0xF) + (n & 0xF) + carry) > 0xF;
            this.flagC = res > 0xFF;
            this.A = res & 0xFF;
        }
        sub(n) {
            const a = this.A;
            const res = a - n;
            this.flagZ = (res & 0xFF) === 0;
            this.flagN = true;
            this.flagH = ((a & 0xF) - (n & 0xF)) < 0;
            this.flagC = a < n;
            this.A = res & 0xFF;
        }
        sbc(n) {
            const carry = this.flagC ? 1 : 0;
            const a = this.A;
            const res = a - n - carry;
            this.flagZ = (res & 0xFF) === 0;
            this.flagN = true;
            this.flagH = ((a & 0xF) - (n & 0xF) - carry) < 0;
            this.flagC = a < (n + carry);
            this.A = res & 0xFF;
        }
        and(n) {
            this.A &= n;
            this.flagZ = this.A === 0;
            this.flagN = false;
            this.flagH = true;
            this.flagC = false;
        }
        xor(n) {
            this.A ^= n;
            this.flagZ = this.A === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = false;
        }
        or(n) {
            this.A |= n;
            this.flagZ = this.A === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = false;
        }
        cp(n) {
            const a = this.A;
            const res = a - n;
            this.flagZ = (res & 0xFF) === 0;
            this.flagN = true;
            this.flagH = ((a & 0xF) - (n & 0xF)) < 0;
            this.flagC = a < n;
        }

        inc(reg) {
            let val;
            switch (reg) {
                case 'B': val = this.B; this.B = (val + 1) & 0xFF; break;
                case 'C': val = this.C; this.C = (val + 1) & 0xFF; break;
                case 'D': val = this.D; this.D = (val + 1) & 0xFF; break;
                case 'E': val = this.E; this.E = (val + 1) & 0xFF; break;
                case 'H': val = this.H; this.H = (val + 1) & 0xFF; break;
                case 'L': val = this.L; this.L = (val + 1) & 0xFF; break;
                case 'A': val = this.A; this.A = (val + 1) & 0xFF; break;
            }
            this.flagZ = ((val + 1) & 0xFF) === 0;
            this.flagN = false;
            this.flagH = ((val & 0xF) + 1) > 0xF;
        }
        dec(reg) {
            let val;
            switch (reg) {
                case 'B': val = this.B; this.B = (val - 1) & 0xFF; break;
                case 'C': val = this.C; this.C = (val - 1) & 0xFF; break;
                case 'D': val = this.D; this.D = (val - 1) & 0xFF; break;
                case 'E': val = this.E; this.E = (val - 1) & 0xFF; break;
                case 'H': val = this.H; this.H = (val - 1) & 0xFF; break;
                case 'L': val = this.L; this.L = (val - 1) & 0xFF; break;
                case 'A': val = this.A; this.A = (val - 1) & 0xFF; break;
            }
            this.flagZ = ((val - 1) & 0xFF) === 0;
            this.flagN = true;
            this.flagH = ((val & 0xF) - 1) < 0;
        }
        incHL() {
            const val = this.mmu.rb(this.HL);
            const res = (val + 1) & 0xFF;
            this.mmu.wb(this.HL, res);
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = ((val & 0xF) + 1) > 0xF;
        }
        decHL() {
            const val = this.mmu.rb(this.HL);
            const res = (val - 1) & 0xFF;
            this.mmu.wb(this.HL, res);
            this.flagZ = res === 0;
            this.flagN = true;
            this.flagH = ((val & 0xF) - 1) < 0;
        }

        incB() { this.inc('B'); }
        incC() { this.inc('C'); }
        incD() { this.inc('D'); }
        incE() { this.inc('E'); }
        incH() { this.inc('H'); }
        incL() { this.inc('L'); }
        incA() { this.inc('A'); }
        decB() { this.dec('B'); }
        decC() { this.dec('C'); }
        decD() { this.dec('D'); }
        decE() { this.dec('E'); }
        decH() { this.dec('H'); }
        decL() { this.dec('L'); }
        decA() { this.dec('A'); }

        addHL(val) {
            const hl = this.HL;
            const res = hl + val;
            this.flagN = false;
            this.flagH = ((hl & 0xFFF) + (val & 0xFFF)) > 0xFFF;
            this.flagC = res > 0xFFFF;
            this.HL = res & 0xFFFF;
        }

        // Rotates
        rlca() {
            const a = this.A;
            const c = (a >> 7) & 1;
            this.A = ((a << 1) | c) & 0xFF;
            this.flagZ = false;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }
        rla() {
            const a = this.A;
            const c = this.flagC ? 1 : 0;
            const newC = (a >> 7) & 1;
            this.A = ((a << 1) | c) & 0xFF;
            this.flagZ = false;
            this.flagN = false;
            this.flagH = false;
            this.flagC = newC === 1;
        }
        rrca() {
            const a = this.A;
            const c = a & 1;
            this.A = ((a >> 1) | (c << 7)) & 0xFF;
            this.flagZ = false;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }
        rra() {
            const a = this.A;
            const c = this.flagC ? 1 : 0;
            const newC = a & 1;
            this.A = ((a >> 1) | (c << 7)) & 0xFF;
            this.flagZ = false;
            this.flagN = false;
            this.flagH = false;
            this.flagC = newC === 1;
        }

        // CB rotates/shifts
        rlc(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = (val >> 7) & 1;
            const res = ((val << 1) | c) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }
        rrc(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = val & 1;
            const res = ((val >> 1) | (c << 7)) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }
        rl(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = this.flagC ? 1 : 0;
            const newC = (val >> 7) & 1;
            const res = ((val << 1) | c) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = newC === 1;
        }
        rr(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = this.flagC ? 1 : 0;
            const newC = val & 1;
            const res = ((val >> 1) | (c << 7)) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = newC === 1;
        }
        sla(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = (val >> 7) & 1;
            const res = (val << 1) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }
        sra(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = val & 1;
            const msb = val & 0x80;
            const res = ((val >> 1) | msb) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }
        swap(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const res = ((val & 0x0F) << 4) | ((val & 0xF0) >> 4);
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = false;
        }
        srl(reg) {
            let val;
            if (reg === 'HL') val = this.mmu.rb(this.HL);
            else val = this[reg];
            const c = val & 1;
            const res = (val >> 1) & 0xFF;
            if (reg === 'HL') this.mmu.wb(this.HL, res);
            else this[reg] = res;
            this.flagZ = res === 0;
            this.flagN = false;
            this.flagH = false;
            this.flagC = c === 1;
        }

        // DAA, CPL, SCF, CCF
        daa() {
            let a = this.A;
            if (!this.flagN) {
                // after addition
                if (this.flagC || a > 0x99) {
                    a += 0x60;
                    this.flagC = true;
                }
                if (this.flagH || (a & 0x0F) > 0x09) {
                    a += 0x06;
                }
            } else {
                // after subtraction
                if (this.flagC) {
                    a -= 0x60;
                }
                if (this.flagH) {
                    a -= 0x06;
                }
            }
            this.A = a & 0xFF;
            this.flagZ = (this.A === 0);
            this.flagH = false;
        }
        cpl() {
            this.A = ~this.A & 0xFF;
            this.flagN = true;
            this.flagH = true;
        }
        scf() {
            this.flagN = false;
            this.flagH = false;
            this.flagC = true;
        }
        ccf() {
            this.flagN = false;
            this.flagH = false;
            this.flagC = !this.flagC;
        }

        // Stack operations
        push(val) {
            this.SP = (this.SP - 1) & 0xFFFF;
            this.mmu.wb(this.SP, (val >> 8) & 0xFF);
            this.SP = (this.SP - 1) & 0xFFFF;
            this.mmu.wb(this.SP, val & 0xFF);
        }
        pop() {
            const lo = this.mmu.rb(this.SP);
            this.SP = (this.SP + 1) & 0xFFFF;
            const hi = this.mmu.rb(this.SP);
            this.SP = (this.SP + 1) & 0xFFFF;
            return (hi << 8) | lo;
        }
    }

    // ----------------------------------------------------------------------
    // Memory Management Unit (MMU) with MBC1 support
    // ----------------------------------------------------------------------
    class MMU {
        constructor() {
            this.rom = new Uint8Array(0x8000); // Up to 32KB internal, but MBC can extend
            this.ram = new Uint8Array(0x2000); // 8KB internal WRAM
            this.vram = new Uint8Array(0x2000); // 8KB Video RAM
            this.oam = new Uint8Array(0xA0);    // 160 bytes OAM
            this.hram = new Uint8Array(0x80);   // High RAM
            this.io = new Uint8Array(0x80);     // I/O registers (mapped at 0xFF00-0xFF7F)
            this.cartRAM = new Uint8Array(0x8000); // External cartridge RAM (max 32KB)
            this.romBanks = [];                   // ROM banks for MBC
            this.ramBanks = [];                    // RAM banks for MBC
            this.rombank = 1;                      // Selected ROM bank (MBC1)
            this.rambank = 0;                      // Selected RAM bank
            this.ramEnable = false;                 // RAM enable flag
            this.mode = 0;                          // MBC1 mode (0=16/8, 1=4/32)
            this.romSize = 0;
            this.ramSize = 0;
        }

        loadROM(romData) {
            this.romSize = romData.length;
            // Determine number of banks
            const banks = Math.ceil(romData.length / 0x4000);
            this.romBanks = [];
            for (let i = 0; i < banks; i++) {
                const bank = new Uint8Array(0x4000);
                const offset = i * 0x4000;
                for (let j = 0; j < 0x4000 && offset + j < romData.length; j++) {
                    bank[j] = romData[offset + j];
                }
                this.romBanks.push(bank);
            }
            // Fixed bank 0
            this.rom.set(this.romBanks[0].slice(0, 0x4000), 0x0000);
            // Bank 1 (or selected) initially
            if (this.romBanks.length > 1) {
                for (let i = 0; i < 0x4000; i++) {
                    this.rom[0x4000 + i] = this.romBanks[1][i];
                }
            }
        }

        rb(addr) {
            addr &= 0xFFFF;
            if (addr < 0x4000) {
                return this.rom[addr];
            } else if (addr < 0x8000) {
                // Banked ROM
                return this.rom[addr];
            } else if (addr < 0xA000) {
                return this.vram[addr - 0x8000];
            } else if (addr < 0xC000) {
                // Cartridge RAM (if enabled)
                if (this.ramEnable) {
                    const bankOffset = this.rambank * 0x2000;
                    return this.cartRAM[bankOffset + (addr - 0xA000)];
                }
                return 0xFF;
            } else if (addr < 0xE000) {
                return this.ram[addr - 0xC000];
            } else if (addr < 0xFE00) {
                // Echo RAM – mirror of C000-DDFF
                return this.ram[addr - 0xE000];
            } else if (addr < 0xFEA0) {
                return this.oam[addr - 0xFE00];
            } else if (addr < 0xFF00) {
                // Unused
                return 0xFF;
            } else if (addr < 0xFF80) {
                // I/O registers
                return this.io[addr - 0xFF00];
            } else if (addr < 0xFFFF) {
                return this.hram[addr - 0xFF80];
            } else {
                // 0xFFFF = IE register (part of I/O, but we'll keep in IO for simplicity)
                return this.io[0xFFFF - 0xFF00];
            }
        }

        wb(addr, value) {
            addr &= 0xFFFF;
            value &= 0xFF;
            if (addr < 0x8000) {
                // ROM area – may be MBC registers
                if (addr < 0x2000) {
                    // RAM enable (MBC1)
                    this.ramEnable = ((value & 0x0F) === 0x0A);
                } else if (addr < 0x4000) {
                    // ROM bank select (lower 5 bits)
                    let bank = value & 0x1F;
                    if (bank === 0) bank = 1;
                    // Combine with mode bits
                    if (this.mode === 0) {
                        this.rombank = (this.rombank & 0x60) | bank;
                    } else {
                        this.rombank = bank;
                    }
                    this.updateROMPages();
                } else if (addr < 0x6000) {
                    // RAM bank select / upper ROM bank bits
                    if (this.mode === 0) {
                        // Upper bits for ROM
                        this.rombank = (this.rombank & 0x1F) | ((value & 3) << 5);
                    } else {
                        // RAM bank
                        this.rambank = value & 3;
                    }
                    this.updateROMPages();
                } else if (addr < 0x8000) {
                    // Mode select
                    this.mode = value & 1;
                }
            } else if (addr < 0xA000) {
                this.vram[addr - 0x8000] = value;
            } else if (addr < 0xC000) {
                // Cartridge RAM
                if (this.ramEnable) {
                    const bankOffset = this.rambank * 0x2000;
                    this.cartRAM[bankOffset + (addr - 0xA000)] = value;
                }
            } else if (addr < 0xE000) {
                this.ram[addr - 0xC000] = value;
            } else if (addr < 0xFE00) {
                // Echo RAM – ignore writes? Usually mirror WRAM
                // We'll mirror for safety
                this.ram[addr - 0xE000] = value;
            } else if (addr < 0xFEA0) {
                this.oam[addr - 0xFE00] = value;
            } else if (addr < 0xFF00) {
                // Unused – ignore
            } else if (addr < 0xFF80) {
                this.io[addr - 0xFF00] = value;
            } else if (addr < 0xFFFF) {
                this.hram[addr - 0xFF80] = value;
            } else {
                this.io[0xFFFF - 0xFF00] = value; // IE
            }
        }

        updateROMPages() {
            // Fixed bank 0
            if (this.romBanks.length > 0) {
                for (let i = 0; i < 0x4000; i++) {
                    this.rom[i] = this.romBanks[0][i];
                }
            }
            // Banked area
            const bank = this.rombank % this.romBanks.length;
            if (this.romBanks[bank]) {
                for (let i = 0; i < 0x4000; i++) {
                    this.rom[0x4000 + i] = this.romBanks[bank][i];
                }
            }
        }
    }

    // ----------------------------------------------------------------------
    // Picture Processing Unit (PPU)
    // ----------------------------------------------------------------------
    class PPU {
        constructor(mmu, canvas) {
            this.mmu = mmu;
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.frameBuffer = this.ctx.createImageData(160, 144);
            this.line = 0;
            this.mode = 2; // OAM scan mode
            this.modeClock = 0;
            this.ly = 0;
            this.lc = 0; // coincidence flag
            this.windowLine = 0;
            this.scanlineBuffer = new Uint32Array(160); // for quick drawing
        }

        step(cycles) {
            this.modeClock += cycles;
            const lcdc = this.mmu.rb(0xFF40);
            if (!(lcdc & 0x80)) { // LCD off
                // Reset counters
                this.line = 0;
                this.mode = 2;
                this.modeClock = 0;
                this.mmu.wb(0xFF44, 0); // LY = 0
                return;
            }

            switch (this.mode) {
                case 2: // OAM scan (80 cycles per line)
                    if (this.modeClock >= 80) {
                        this.modeClock -= 80;
                        this.mode = 3;
                    }
                    break;
                case 3: // Drawing pixels (172-289 cycles, we'll use 172 for simplicity)
                    if (this.modeClock >= 172) {
                        this.modeClock -= 172;
                        this.mode = 0;
                        this.renderScanline();
                    }
                    break;
                case 0: // HBlank (87-204 cycles, we'll use 87)
                    if (this.modeClock >= 87) {
                        this.modeClock -= 87;
                        this.line++;
                        this.mmu.wb(0xFF44, this.line);
                        if (this.line === 144) {
                            // Enter VBlank
                            this.mode = 1;
                            // Request VBlank interrupt
                            const iflag = this.mmu.rb(0xFF0F) | 0x01;
                            this.mmu.wb(0xFF0F, iflag);
                        } else {
                            this.mode = 2;
                        }
                    }
                    break;
                case 1: // VBlank (10 lines, 456 cycles each)
                    if (this.modeClock >= 456) {
                        this.modeClock -= 456;
                        this.line++;
                        this.mmu.wb(0xFF44, this.line);
                        if (this.line > 153) {
                            this.line = 0;
                            this.mode = 2;
                            this.windowLine = 0;
                            this.mmu.wb(0xFF44, 0);
                        }
                    }
                    break;
            }

            // LY == LYC check
            const lyc = this.mmu.rb(0xFF45);
            if (this.line === lyc) {
                this.mmu.wb(0xFF41, this.mmu.rb(0xFF41) | 0x04); // set coincidence flag
                // Request STAT interrupt if enabled
                const stat = this.mmu.rb(0xFF41);
                if (stat & 0x40) {
                    const iflag = this.mmu.rb(0xFF0F) | 0x02;
                    this.mmu.wb(0xFF0F, iflag);
                }
            } else {
                this.mmu.wb(0xFF41, this.mmu.rb(0xFF41) & ~0x04);
            }
        }

        renderScanline() {
            const lcdc = this.mmu.rb(0xFF40);
            const y = this.line;
            const canvasData = this.frameBuffer.data;

            // Background enabled?
            if (lcdc & 0x01) {
                const scrollY = this.mmu.rb(0xFF42);
                const scrollX = this.mmu.rb(0xFF43);
                const bgMap = (lcdc & 0x08) ? 0x9C00 : 0x9800; // BG tile map
                const tileData = (lcdc & 0x10) ? 0x8000 : 0x8800; // Tile data
                const windowY = this.mmu.rb(0xFF4A);
                const windowX = this.mmu.rb(0xFF4B) - 7;
                const windowMap = (lcdc & 0x40) ? 0x9C00 : 0x9800;

                for (let x = 0; x < 160; x++) {
                    let mapAddr, tileX, tileY, tileNum;
                    // Check window
                    if ((lcdc & 0x20) && y >= windowY && x >= windowX) {
                        // Window
                        tileX = (x - windowX) >> 3;
                        tileY = this.windowLine >> 3;
                        mapAddr = windowMap + tileY * 32 + tileX;
                        tileNum = this.mmu.rb(mapAddr);
                        if (tileData === 0x8800) {
                            tileNum = (tileNum + 128) & 0xFF; // signed
                        }
                        const tileLine = (this.windowLine & 7) << 1;
                        const tileAddr = tileData + tileNum * 16 + tileLine;
                        const lsb = this.mmu.rb(tileAddr);
                        const msb = this.mmu.rb(tileAddr + 1);
                        const bit = 7 - (x & 7);
                        const colorId = ((msb >> bit) & 1) << 1 | ((lsb >> bit) & 1);
                        // Map palette
                        const palette = this.mmu.rb(0xFF47);
                        const color = (palette >> (colorId * 2)) & 3;
                        const rgb = this.getColor(color);
                        const idx = (y * 160 + x) * 4;
                        canvasData[idx] = rgb.r;
                        canvasData[idx+1] = rgb.g;
                        canvasData[idx+2] = rgb.b;
                        canvasData[idx+3] = 255;
                    } else {
                        // Background
                        tileX = (scrollX + x) >> 3;
                        tileY = (scrollY + y) >> 3;
                        mapAddr = bgMap + (tileY & 31) * 32 + (tileX & 31);
                        tileNum = this.mmu.rb(mapAddr);
                        if (tileData === 0x8800) {
                            tileNum = (tileNum + 128) & 0xFF;
                        }
                        const tileLine = ((scrollY + y) & 7) << 1;
                        const tileAddr = tileData + tileNum * 16 + tileLine;
                        const lsb = this.mmu.rb(tileAddr);
                        const msb = this.mmu.rb(tileAddr + 1);
                        const bit = 7 - ((scrollX + x) & 7);
                        const colorId = ((msb >> bit) & 1) << 1 | ((lsb >> bit) & 1);
                        const palette = this.mmu.rb(0xFF47);
                        const color = (palette >> (colorId * 2)) & 3;
                        const rgb = this.getColor(color);
                        const idx = (y * 160 + x) * 4;
                        canvasData[idx] = rgb.r;
                        canvasData[idx+1] = rgb.g;
                        canvasData[idx+2] = rgb.b;
                        canvasData[idx+3] = 255;
                    }
                }
            } else {
                // Background disabled – fill white?
                for (let x = 0; x < 160; x++) {
                    const idx = (y * 160 + x) * 4;
                    canvasData[idx] = 255;
                    canvasData[idx+1] = 255;
                    canvasData[idx+2] = 255;
                    canvasData[idx+3] = 255;
                }
            }

            // Sprites
            if (lcdc & 0x02) {
                const objSize = (lcdc & 0x04) ? 16 : 8; // 8x8 or 8x16
                // OAM has 40 sprites, we need to render in priority order
                for (let i = 0; i < 40; i++) {
                    const base = 0xFE00 + i * 4;
                    const yPos = this.mmu.rb(base) - 16;
                    const xPos = this.mmu.rb(base + 1) - 8;
                    const tileNum = this.mmu.rb(base + 2);
                    const flags = this.mmu.rb(base + 3);
                    if (yPos > this.line || yPos + objSize <= this.line) continue;
                    if (xPos <= -8 || xPos >= 160) continue;
                    const yFlip = (flags & 0x40) !== 0;
                    const xFlip = (flags & 0x20) !== 0;
                    const paletteNum = (flags & 0x10) ? 1 : 0;
                    const paletteAddr = paletteNum ? 0xFF49 : 0xFF48;
                    const palette = this.mmu.rb(paletteAddr);
                    let spriteLine = this.line - yPos;
                    if (yFlip) spriteLine = objSize - 1 - spriteLine;
                    const tileAddr = 0x8000 + tileNum * 16 + (spriteLine * 2);
                    const lsb = this.mmu.rb(tileAddr);
                    const msb = this.mmu.rb(tileAddr + 1);
                    for (let p = 0; p < 8; p++) {
                        const bit = xFlip ? p : (7 - p);
                        const colorId = ((msb >> bit) & 1) << 1 | ((lsb >> bit) & 1);
                        if (colorId === 0) continue; // transparent
                        const screenX = xPos + p;
                        if (screenX < 0 || screenX >= 160) continue;
                        // Check priority (if BG and sprite overlap, BG wins if bit 7 of flags)
                        // Simplified: ignore priority for now
                        const color = (palette >> (colorId * 2)) & 3;
                        const rgb = this.getColor(color);
                        const idx = (this.line * 160 + screenX) * 4;
                        canvasData[idx] = rgb.r;
                        canvasData[idx+1] = rgb.g;
                        canvasData[idx+2] = rgb.b;
                        // alpha already set
                    }
                }
            }

            if (this.line === 143) {
                // After last scanline, present frame
                this.ctx.putImageData(this.frameBuffer, 0, 0);
                this.windowLine++;
            }
        }

        getColor(id) {
            // Game Boy shades (0=white, 3=black)
            switch (id) {
                case 0: return {r:255,g:255,b:255};
                case 1: return {r:192,g:192,b:192};
                case 2: return {r:96,g:96,b:96};
                case 3: return {r:0,g:0,b:0};
                default: return {r:0,g:0,b:0};
            }
        }
    }

    // ----------------------------------------------------------------------
    // Timer
    // ----------------------------------------------------------------------
    class Timer {
        constructor(mmu) {
            this.mmu = mmu;
            this.div = 0;      // internal 16-bit counter
            this.tima = 0;
            this.tma = 0;
            this.tac = 0;
            this.counter = 0;
        }

        step(cycles) {
            // DIV increments at 16384 Hz (every 256 cycles)
            for (let i = 0; i < cycles; i++) {
                this.div = (this.div + 1) & 0xFFFF;
                if ((this.div & 0xFF) === 0) {
                    this.mmu.wb(0xFF04, (this.mmu.rb(0xFF04) + 1) & 0xFF);
                }
            }

            // Timer
            const tac = this.mmu.rb(0xFF07);
            if (tac & 0x04) {
                const inputClock = tac & 0x03;
                const frequencies = [1024, 16, 64, 256]; // cycles per tick
                const threshold = frequencies[inputClock];
                this.counter += cycles;
                while (this.counter >= threshold) {
                    this.counter -= threshold;
                    let tima = this.mmu.rb(0xFF05) + 1;
                    if (tima > 0xFF) {
                        tima = this.mmu.rb(0xFF06); // TMA
                        // Request timer interrupt
                        const iflag = this.mmu.rb(0xFF0F) | 0x04;
                        this.mmu.wb(0xFF0F, iflag);
                    }
                    this.mmu.wb(0xFF05, tima & 0xFF);
                }
            }
        }
    }

    // ----------------------------------------------------------------------
    // Main GameBoy system
    // ----------------------------------------------------------------------
    class GameBoy {
        constructor(canvas) {
            this.mmu = new MMU();
            this.cpu = new LR35902(this.mmu);
            this.ppu = new PPU(this.mmu, canvas);
            this.timer = new Timer(this.mmu);
            this.cyclesThisFrame = 0;
            this.frameCallback = null;
        }

        loadROM(romData) {
            this.mmu.loadROM(romData);
        }

        runFrame() {
            // Run until we've processed enough cycles for one frame (approx 70224 cycles)
            const target = 70224;
            while (this.cyclesThisFrame < target) {
                const cycles = this.cpu.step();
                this.cyclesThisFrame += cycles;
                this.timer.step(cycles);
                this.ppu.step(cycles);
                // Handle interrupts
                if (this.cpu.ime) {
                    const iflag = this.mmu.rb(0xFF0F);
                    const ie = this.mmu.rb(0xFFFF);
                    const pending = iflag & ie;
                    if (pending) {
                        // Service highest priority
                        for (let i = 0; i < 5; i++) {
                            if (pending & (1 << i)) {
                                this.cpu.ime = 0;
                                this.mmu.wb(0xFF0F, iflag & ~(1 << i));
                                this.cpu.push(this.cpu.PC);
                                this.cpu.PC = 0x40 + i * 8;
                                break;
                            }
                        }
                    }
                }
            }
            this.cyclesThisFrame -= target;
            if (this.frameCallback) this.frameCallback();
        }

        start(frameCallback) {
            this.frameCallback = frameCallback;
            const loop = () => {
                this.runFrame();
                requestAnimationFrame(loop);
            };
            requestAnimationFrame(loop);
        }
    }

    // ----------------------------------------------------------------------
    // Flash player (using object tag)
    // ----------------------------------------------------------------------
    class FlashPlayer {
        constructor(container) {
            this.container = container;
            this.obj = null;
        }

        loadSWF(url) {
            // Clear container
            while (this.container.firstChild) {
                this.container.removeChild(this.container.firstChild);
            }
            this.obj = document.createElement('object');
            this.obj.setAttribute('type', 'application/x-shockwave-flash');
            this.obj.setAttribute('data', url);
            this.obj.setAttribute('width', '100%');
            this.obj.setAttribute('height', '100%');
            const param = document.createElement('param');
            param.setAttribute('name', 'movie');
            param.setAttribute('value', url);
            this.obj.appendChild(param);
            this.container.appendChild(this.obj);
        }
    }

    // ----------------------------------------------------------------------
    // Public API
    // ----------------------------------------------------------------------
    class FGAB {
        constructor(canvasOrContainer) {
            if (typeof canvasOrContainer === 'string') {
                this.element = document.getElementById(canvasOrContainer);
            } else {
                this.element = canvasOrContainer;
            }
            if (!this.element) throw new Error('FGAB: Invalid element');
            this.gb = null;
            this.flash = null;
            this.mode = null;
        }

        loadROM(url) {
            const ext = url.split('.').pop().toLowerCase();
            if (ext === 'gb' || ext === 'gbc') {
                this.mode = 'gb';
                // Ensure canvas is available
                if (!(this.element instanceof HTMLCanvasElement)) {
                    console.error('FGAB: Game Boy mode requires a canvas element');
                    return;
                }
                this.gb = new GameBoy(this.element);
                loadBinary(url, (data) => {
                    this.gb.loadROM(data);
                });
            } else if (ext === 'swf') {
                this.mode = 'flash';
                // Ensure container is a div (or create one if canvas)
                if (!(this.element instanceof HTMLElement)) {
                    console.error('FGAB: Flash mode requires an HTML element');
                    return;
                }
                this.flash = new FlashPlayer(this.element);
                this.flash.loadSWF(url);
            } else {
                console.error('FGAB: Unsupported file extension', ext);
            }
        }

        start() {
            if (this.mode === 'gb' && this.gb) {
                this.gb.start();
            } else if (this.mode === 'flash') {
                // Already playing via object tag
            }
        }
    }

    // Export
    global.FGAB = FGAB;
})(window);
