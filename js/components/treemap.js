// js/components/treemap.js

/**
 * Pixel-Perfect Treemap with Strict Boundary Alignment
 * Ensures all assets are visible within the SVG container.
 */
export class Treemap {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = {
      width: 1200,
      padding: 1,
      groupHeaderHeight: 25,
      safetyMargin: 4, // Final margin to prevent edge clipping
      ...options,
    };
  }

  render(data, customHeight) {
    if (!this.container) return;
    this.container.innerHTML = "";

    const rect = this.container.getBoundingClientRect();
    // Use container width minus scrollbar space if possible
    const width = rect.width > 20 ? rect.width - 6 : this.options.width;
    const height = customHeight || 700;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.style.display = "block";
    svg.style.backgroundColor = "#000";
    svg.style.fontFamily = "'Inter', system-ui, -apple-system, sans-serif";

    const totalValue = data.reduce((sum, group) => sum + group.value, 0);
    if (totalValue === 0) {
      this.container.innerHTML =
        "<div style='display:flex;align-items:center;justify-content:center;height:100%;color:#444;'>NO DATA AVAILABLE</div>";
      return;
    }

    // Apply a small internal margin so the right/bottom borders aren't clipped
    const renderW = width - this.options.safetyMargin;
    const renderH = height - this.options.safetyMargin;

    const totalArea = renderW * renderH;
    const dataWithArea = data.map((item) => ({
      ...item,
      area: (item.value / totalValue) * totalArea,
    }));

    this.squarify(dataWithArea, 0, 0, renderW, renderH, svg, true);
    this.container.appendChild(svg);
  }

  squarify(items, x, y, w, h, svg, isGroup = false) {
    if (w <= 1 || h <= 1 || !items || items.length === 0) return;
    items.sort((a, b) => b.area - a.area);
    this.process(items, [], Math.min(w, h), x, y, w, h, svg, isGroup);
  }

  process(items, row, s, x, y, w, h, svg, isGroup) {
    if (items.length === 0) {
      this.layoutRow(row, s, x, y, w, h, svg, isGroup);
      return;
    }
    const nextItem = items[0];
    const newRow = [...row, nextItem];
    if (this.worst(row, s) >= this.worst(newRow, s)) {
      this.process(items.slice(1), newRow, s, x, y, w, h, svg, isGroup);
    } else {
      const remainingArea = this.layoutRow(row, s, x, y, w, h, svg, isGroup);
      this.process(
        items,
        [],
        Math.min(remainingArea.w, remainingArea.h),
        remainingArea.x,
        remainingArea.y,
        remainingArea.w,
        remainingArea.h,
        svg,
        isGroup,
      );
    }
  }

  worst(row, s) {
    if (row.length === 0) return Infinity;
    const sum = row.reduce((s, i) => s + i.area, 0);
    const max = Math.max(...row.map((i) => i.area));
    const min = Math.min(...row.map((i) => i.area));
    const s2 = s * s;
    return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
  }

  layoutRow(row, s, x, y, w, h, svg, isGroup) {
    if (row.length === 0) return { x, y, w, h };
    const rowAreaSum = row.reduce((s, i) => s + i.area, 0);
    let rx, ry, rw, rh;

    if (w >= h) {
      rw = rowAreaSum / h;
      rh = h;
      rx = x;
      ry = y;
      let rowY = y;
      row.forEach((item, idx) => {
        let itemH = rh * (item.area / rowAreaSum);
        // Snap last item to the bottom bound to avoid rounding gaps/overflows
        if (idx === row.length - 1) itemH = y + rh - rowY;

        this.drawItem(
          item,
          rx,
          rowY,
          rw,
          itemH,
          svg,
          isGroup,
          x + rw >= w - 1,
          rowY + itemH >= h - 1,
        );
        rowY += itemH;
      });
      return { x: x + rw, y: y, w: Math.max(0, w - rw), h: h };
    } else {
      rw = w;
      rh = rowAreaSum / w;
      rx = x;
      ry = y;
      let rowX = x;
      row.forEach((item, idx) => {
        let itemW = rw * (item.area / rowAreaSum);
        // Snap last item to the right bound
        if (idx === row.length - 1) itemW = x + rw - rowX;

        this.drawItem(
          item,
          rowX,
          ry,
          itemW,
          rh,
          svg,
          isGroup,
          rowX + itemW >= w - 1,
          y + rh >= h - 1,
        );
        rowX += itemW;
      });
      return { x: x, y: y + rh, w: w, h: Math.max(0, h - rh) };
    }
  }

  drawItem(item, x, y, w, h, svg, isGroup, isAtRight, isAtBottom) {
    const p = this.options.padding;
    const ix = x + p;
    const iy = y + p;
    // Ensure width/height are never negative
    const iw = Math.max(0.5, w - (isAtRight ? p : 2 * p));
    const ih = Math.max(0.5, h - (isAtBottom ? p : 2 * p));

    if (iw <= 0.1 || ih <= 0.1) return;

    if (isGroup && item.children) {
      // SECTOR
      const groupRect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      groupRect.setAttribute("x", ix);
      groupRect.setAttribute("y", iy);
      groupRect.setAttribute("width", iw);
      groupRect.setAttribute("height", ih);
      groupRect.setAttribute("fill", "#09090b");
      groupRect.setAttribute("stroke", "#27272a");
      groupRect.setAttribute("stroke-width", "0.5");
      svg.appendChild(groupRect);

      const headH = Math.min(this.options.groupHeaderHeight, ih * 0.3);
      if (headH > 10 && iw > 30) {
        const label = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        label.setAttribute("x", ix + 4);
        label.setAttribute("y", iy + headH - 7);
        label.setAttribute("fill", "#52525b");
        label.setAttribute("font-size", Math.min(headH - 8, 10) + "px");
        label.setAttribute("font-weight", "bold");
        label.setAttribute("pointer-events", "none");
        label.textContent = item.name.toUpperCase();
        svg.appendChild(label);
      }

      if (ih > headH + 2) {
        const childW = iw;
        const childH = ih - headH;
        const childArea = childW * childH;
        const childTotalValue = item.children.reduce((s, c) => s + c.value, 0);
        const childrenWithArea = item.children.map((c) => ({
          ...c,
          area: (c.value / childTotalValue) * childArea,
        }));
        this.squarify(
          childrenWithArea,
          ix,
          iy + headH,
          childW,
          childH,
          svg,
          false,
        );
      }
    } else {
      // ASSET
      const rect = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "rect",
      );
      rect.setAttribute("x", ix);
      rect.setAttribute("y", iy);
      rect.setAttribute("width", iw);
      rect.setAttribute("height", ih);
      rect.setAttribute("fill", this.getColor(item.colorValue));
      rect.setAttribute("stroke", "#000");
      rect.setAttribute("stroke-width", "0.2");

      rect.style.cursor = "pointer";
      rect.addEventListener("mouseenter", (e) => this.showTooltip(e, item));
      rect.addEventListener("mouseleave", () => this.hideTooltip());

      svg.appendChild(rect);

      // Labels: Ticker + %
      if (iw > 16 && ih > 12) {
        const group = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "g",
        );
        group.setAttribute("pointer-events", "none");

        const tickerSize = Math.max(6, Math.min(iw / 3, ih / 2.2, 15));
        const pctSize = Math.max(5, Math.min(iw / 4.5, ih / 3.5, 10));

        const ticker = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "text",
        );
        ticker.setAttribute("x", ix + iw / 2);
        ticker.setAttribute("y", iy + ih / 2 - (ih > 25 ? 2 : 0));
        ticker.setAttribute("text-anchor", "middle");
        ticker.setAttribute("dominant-baseline", "middle");
        ticker.setAttribute("fill", "#fff");
        ticker.setAttribute("font-size", tickerSize + "px");
        ticker.setAttribute("font-weight", "bold");
        ticker.textContent = item.name;
        group.appendChild(ticker);

        if (ih > 28 && iw > 30) {
          const pctValue = (item.growth * 100 || 0).toFixed(2);
          const pct = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "text",
          );
          pct.setAttribute("x", ix + iw / 2);
          pct.setAttribute("y", iy + ih / 2 + tickerSize / 2 + 4);
          pct.setAttribute("text-anchor", "middle");
          pct.setAttribute("dominant-baseline", "middle");
          pct.setAttribute("fill", "rgba(255,255,255,0.7)");
          pct.setAttribute("font-size", pctSize + "px");
          pct.textContent = (pctValue >= 0 ? "+" : "") + pctValue + "%";
          group.appendChild(pct);
        }
        svg.appendChild(group);
      }
    }
  }

  getColor(val) {
    // High Contrast Finviz Scale: Easier transition to green
    const v = Math.max(0, Math.min(1, val));
    const g = { r: 34, g: 197, b: 94 }; // Emerald Green
    const n = { r: 38, g: 38, b: 38 }; // Dark Neutral
    const r = { r: 239, g: 68, b: 68 }; // Bright Red

    const threshold = 0.45; // Move midpoint left to favor greens

    let res;
    if (v >= threshold) {
      const t = (v - threshold) / (1 - threshold);
      res = {
        r: n.r + (g.r - n.r) * Math.pow(t, 0.8),
        g: n.g + (g.g - n.g) * Math.pow(t, 0.8),
        b: n.b + (g.b - n.b) * Math.pow(t, 0.8),
      };
    } else {
      const t = v / threshold;
      res = {
        r: r.r + (n.r - r.r) * t,
        g: r.g + (n.g - r.g) * t,
        b: r.b + (n.b - r.b) * t,
      };
    }
    return `rgb(${Math.round(res.r)}, ${Math.round(res.g)}, ${Math.round(res.b)})`;
  }

  showTooltip(e, item) {
    let tip = document.getElementById("treemap-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "treemap-tooltip";
      tip.style.position = "fixed";
      tip.style.padding = "10px";
      tip.style.background = "#0c0c0e";
      tip.style.color = "#efeff1";
      tip.style.borderRadius = "6px";
      tip.style.fontSize = "12px";
      tip.style.pointerEvents = "none";
      tip.style.zIndex = "10000";
      tip.style.border = "1px solid #27272a";
      tip.style.boxShadow = "0 8px 30px rgba(0,0,0,0.9)";
      document.body.appendChild(tip);
    }
    const m = item.meta || {};
    const eur = (v) =>
      v
        ? new Intl.NumberFormat("pt-PT", {
            style: "currency",
            currency: "EUR",
          }).format(v)
        : "—";
    tip.innerHTML = `
            <div style="font-weight:bold; margin-bottom:4px; border-bottom:1px solid #222; padding-bottom:4px">${item.fullName || item.name}</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:4px 12px;">
                <span>Score: <b>${(item.colorValue * 100).toFixed(1)}%</b></span>
                <span>Preço: <b>${eur(m.valorStock)}</b></span>
                <span>Growth: <b style="color:${item.growth >= 0 ? "#22c55e" : "#ef4444"}">${(item.growth * 100 || 0).toFixed(2)}%</b></span>
                <span>Yield: <b>${(item.yield || 0).toFixed(2)}%</b></span>
            </div>
        `;
    tip.style.display = "block";
    this.updateTooltipPos(e);
  }

  updateTooltipPos(e) {
    const tip = document.getElementById("treemap-tooltip");
    if (tip) {
      const x = e.clientX + 15;
      const y = e.clientY + 15;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
      const rect = tip.getBoundingClientRect();
      if (x + rect.width > window.innerWidth)
        tip.style.left = e.clientX - rect.width - 15 + "px";
      if (y + rect.height > window.innerHeight)
        tip.style.top = e.clientY - rect.height - 15 + "px";
    }
  }

  hideTooltip() {
    const tip = document.getElementById("treemap-tooltip");
    if (tip) tip.style.display = "none";
  }
}
