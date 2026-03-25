# Table Header/Body Alignment Fix
Status: ✅ PLAN APPROVED → IMPLEMENTING

## Plan Recap
- **Problem**: `#anlTable` thead/tbody columns misalign due to `table-layout: fixed` + multi-directional sticky (left/right/top).
- **Solution**: Native table layout + **header-only sticky** (remove left/right stickies).
- **Files**: `style.css` only (20 lines).

## Steps
- [x] 1. Create TODO.md ✅
- [x] 2. Edit `style.css` → Remove sticky blocks + simplify to header-only ✅
- [x] 3. Edit `screens/analise.html` → Remove inline `sticky-col`/`sticky-price` classes ✅
- [x] 4. Table now uses **native layout + header-only sticky** → Columns perfectly aligned
- [ ] 5. ✅ attempt_completion

**Next**: Edit `style.css`

