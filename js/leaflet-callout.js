/**
 * Leaflet Callout Annotation Plugin
 * Renders callout boxes with configurable leader lines and arrowheads.
 */
;(function (factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('leaflet'));
    } else {
        factory(window.L);
    }
}(function (L) {
    'use strict';

    L.CalloutLayer = L.Layer.extend({

        options: {
            storageKey: null,
            defaultStyle: {
                fontSize:     14,
                textColor:    '#1a1a1a',
                bgColor:      '#fffde7',
                borderColor:  '#5c5c5c',
                borderWidth:  1.5,
                padding:      10,
                arrowColor:   '#5c5c5c',
                arrowWidth:   2,
                arrowSize:    12,
                boxWidth:     160,
                boxHeight:    0,
                cornerRadius: 4,
                leaderStyle:  'elbow',
                elbowLength:  20
            }
        },

        initialize: function (options) {
            L.setOptions(this, options);
            this._callouts     = new Map();
            this._nextId       = 1;
            this._selectedId   = null;
            this._mode         = 'select';
            this._historyStack = [];
            this._historyIndex = -1;
            this._histTimer    = null;
        },

        onAdd: function (map) {
            this._map = map;
            this._svg = this._createSVG();
            map.getContainer().appendChild(this._svg);
            map.on('move zoom', this._redrawAll, this);
            this._containerClickHandler = this._onContainerClick.bind(this);
            map.getContainer().addEventListener('click', this._containerClickHandler);
            if (this.options.storageKey) {
                var saved = localStorage.getItem(this.options.storageKey);
                if (saved) { try { this._restoreFromSnapshot(JSON.parse(saved)); } catch (e) {} }
            }
            this._pushHistory();
        },

        onRemove: function (map) {
            map.getContainer().removeChild(this._svg);
            map.off('move zoom', this._redrawAll, this);
            map.getContainer().removeEventListener('click', this._containerClickHandler);
        },

        // ── Public API ─────────────────────────────────────────────────

        setMode: function (mode) {
            this._mode = mode;
            this._map.getContainer().style.cursor = (mode === 'add') ? 'crosshair' : '';
        },

        deselect: function () {
            if (this._selectedId === null) return;
            var prevId = this._selectedId;
            this._selectedId = null;
            var prev = this._callouts.get(prevId);
            if (prev) this._renderCallout(prev);
            this.fire('calloutselect', { callout: null });
        },

        deleteSelected: function () {
            if (this._selectedId === null) return;
            var id = this._selectedId;
            this._selectedId = null;
            var el = this._svg.querySelector('[data-cid="' + id + '"]');
            if (el) el.remove();
            this._removeMarker('callout-arrow-' + id);
            this._removeMarker('callout-clip-'  + id);
            this._callouts.delete(id);
            this.fire('calloutselect', { callout: null });
            this._pushHistory();
            this._autoSave();
        },

        updateSelected: function (changes) {
            if (this._selectedId === null) return;
            var callout = this._callouts.get(this._selectedId);
            if (!callout) return;
            if (changes.text !== undefined) callout.text = changes.text;
            if (changes.style) Object.assign(callout.style, changes.style);
            this._renderCallout(callout);
            this._scheduleHistoryPush();
        },

        getSelected: function () {
            return this._selectedId !== null ? this._callouts.get(this._selectedId) : null;
        },

        undo: function () {
            if (this._historyIndex <= 0) return;
            this._historyIndex--;
            this._restoreFromSnapshot(this._historyStack[this._historyIndex]);
            this._autoSave();
            this._emitHistoryState();
        },

        redo: function () {
            if (this._historyIndex >= this._historyStack.length - 1) return;
            this._historyIndex++;
            this._restoreFromSnapshot(this._historyStack[this._historyIndex]);
            this._autoSave();
            this._emitHistoryState();
        },

        canUndo: function () { return this._historyIndex > 0; },
        canRedo: function () { return this._historyIndex < this._historyStack.length - 1; },

        exportJSON: function () {
            var data = JSON.stringify(this._serialize(), null, 2);
            var blob = new Blob([data], { type: 'application/json' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href = url; a.download = 'callout-annotations.json'; a.click();
            URL.revokeObjectURL(url);
        },

        importJSON: function (jsonString) {
            try {
                this._restoreFromSnapshot(JSON.parse(jsonString));
                this._pushHistory();
                this._autoSave();
            } catch (e) { console.error('Callout import failed:', e); }
        },

        // ── Internal ───────────────────────────────────────────────────

        _createSVG: function () {
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.style.cssText = [
                'position:absolute', 'top:0', 'left:0',
                'width:100%', 'height:100%',
                'overflow:visible', 'pointer-events:none', 'z-index:650'
            ].join(';');
            this._defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svg.appendChild(this._defs);
            return svg;
        },

        _onContainerClick: function (e) {
            // Ignore clicks on Leaflet UI controls
            if (e.target.closest && e.target.closest('.leaflet-control')) return;

            if (this._mode === 'add') {
                // Ignore clicks directly on existing callout boxes (they stop propagation)
                var rect = this._map.getContainer().getBoundingClientRect();
                var px = e.clientX - rect.left;
                var py = e.clientY - rect.top;
                var latlng = this._map.containerPointToLatLng([px, py]);

                var id = this._nextId++;
                var style = Object.assign({}, this.options.defaultStyle);
                var callout = {
                    id: id,
                    anchorLatLng: latlng,
                    boxOffset: { x: 140, y: -95 },
                    text: 'Annotation',
                    style: style
                };
                this._callouts.set(id, callout);
                this._renderCallout(callout);
                this._selectCallout(id);

            } else if (this._mode === 'select') {
                // Click on empty map → deselect
                this.deselect();
            }
        },

        _redrawAll: function () {
            var self = this;
            this._callouts.forEach(function (c) {
                // Don't disrupt an active inline edit
                if (self._editingCalloutId === c.id) return;
                self._renderCallout(c);
            });
        },

        _renderCallout: function (callout) {
            var existing = this._svg.querySelector('[data-cid="' + callout.id + '"]');
            if (existing) existing.remove();

            var ap = this._map.latLngToContainerPoint(callout.anchorLatLng);
            var isSelected = (this._selectedId === callout.id);
            var group = this._buildGroup(callout, ap, isSelected);
            this._svg.appendChild(group);
        },

        _buildGroup: function (callout, ap, isSelected) {
            var s    = callout.style;
            var bx   = ap.x + callout.boxOffset.x;
            var by   = ap.y + callout.boxOffset.y;
            var lineH = s.fontSize * 1.4;
            var boxW  = s.boxWidth;
            var lines = this._wrapText(callout.text || '', s.fontSize, boxW - s.padding * 2);
            var boxH  = (s.boxHeight > 0) ? s.boxHeight : (s.padding * 2 + lines.length * lineH);
            var bLeft = bx - boxW / 2;
            var bTop  = by - boxH / 2;

            var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('data-cid', callout.id);

            // ── Arrow marker ──────────────────────────────────────────
            var markerId = 'callout-arrow-' + callout.id;
            this._setArrowMarker(markerId, s.arrowColor, s.arrowSize);

            // ── Leader: straight or elbow (Adobe-style) ───────────────
            var ep   = this._boxEdgePoint(ap, bx, by, boxW, boxH);
            var dist = Math.hypot(ap.x - ep.x, ap.y - ep.y);

            if (dist > s.arrowSize * 0.6) {
                if (s.leaderStyle === 'elbow') {
                    var el  = s.elbowLength || 20;
                    var edx = ep.x - bx, edy = ep.y - by;
                    var elbow = (Math.abs(edx) >= Math.abs(edy))
                        ? { x: ep.x + (edx > 0 ? el : -el), y: ep.y }
                        : { x: ep.x, y: ep.y + (edy > 0 ? el : -el) };
                    var pline = this._svgEl('polyline');
                    pline.setAttribute('points',       ep.x+','+ep.y+' '+elbow.x+','+elbow.y+' '+ap.x+','+ap.y);
                    pline.setAttribute('stroke',       s.arrowColor);
                    pline.setAttribute('stroke-width', s.arrowWidth);
                    pline.setAttribute('fill',         'none');
                    pline.setAttribute('marker-end',   'url(#' + markerId + ')');
                    g.appendChild(pline);
                } else {
                    var leader = this._svgEl('line');
                    leader.setAttribute('x1', ep.x);  leader.setAttribute('y1', ep.y);
                    leader.setAttribute('x2', ap.x);  leader.setAttribute('y2', ap.y);
                    leader.setAttribute('stroke', s.arrowColor);
                    leader.setAttribute('stroke-width', s.arrowWidth);
                    leader.setAttribute('marker-end', 'url(#' + markerId + ')');
                    g.appendChild(leader);
                }
                var dot = this._svgEl('circle');
                dot.setAttribute('cx', ep.x); dot.setAttribute('cy', ep.y);
                dot.setAttribute('r', s.arrowWidth + 1); dot.setAttribute('fill', s.arrowColor);
                g.appendChild(dot);
            }

            // ── Box ───────────────────────────────────────────────────
            var box = this._svgEl('rect');
            box.setAttribute('x', bLeft); box.setAttribute('y', bTop);
            box.setAttribute('width', boxW); box.setAttribute('height', boxH);
            box.setAttribute('rx', s.cornerRadius); box.setAttribute('fill', s.bgColor);
            box.setAttribute('stroke',       isSelected ? '#1976d2' : s.borderColor);
            box.setAttribute('stroke-width', isSelected ? Math.max(s.borderWidth, 2.5) : s.borderWidth);
            if (isSelected) box.setAttribute('filter', 'drop-shadow(0 2px 8px rgba(25,118,210,0.45))');
            g.appendChild(box);

            // ── Clip path when height is fixed ────────────────────────
            var clipId = 'callout-clip-' + callout.id;
            this._removeMarker(clipId);
            if (s.boxHeight > 0) {
                var cp = this._svgEl('clipPath'); cp.setAttribute('id', clipId);
                var cr = this._svgEl('rect');
                cr.setAttribute('x', bLeft+1); cr.setAttribute('y', bTop+1);
                cr.setAttribute('width', boxW-2); cr.setAttribute('height', boxH-2);
                cp.appendChild(cr); this._defs.appendChild(cp);
            }

            // ── Text ──────────────────────────────────────────────────
            var textEl = this._svgEl('text');
            textEl.setAttribute('font-family', "system-ui,-apple-system,'Segoe UI',Arial,sans-serif");
            textEl.setAttribute('font-size', s.fontSize);
            textEl.setAttribute('fill', s.textColor);
            textEl.style.pointerEvents = 'none';
            textEl.style.userSelect    = 'none';
            if (s.boxHeight > 0) textEl.setAttribute('clip-path', 'url(#' + clipId + ')');
            for (var i = 0; i < lines.length; i++) {
                var tspan = this._svgEl('tspan');
                tspan.setAttribute('x', bLeft + s.padding);
                tspan.setAttribute('y', bTop + s.padding + s.fontSize + i * lineH);
                tspan.textContent = lines[i].length ? lines[i] : '\u00A0';
                textEl.appendChild(tspan);
            }
            g.appendChild(textEl);

            // ── Hit area (click, dblclick→inline edit, drag) ──────────
            var self = this;
            var hit  = this._svgEl('rect');
            hit.setAttribute('x', bLeft); hit.setAttribute('y', bTop);
            hit.setAttribute('width', boxW); hit.setAttribute('height', boxH);
            hit.setAttribute('fill', 'transparent');
            hit.style.pointerEvents = 'all'; hit.style.cursor = 'move';
            hit.addEventListener('click', (function (c) {
                return function (e) {
                    e.stopPropagation();
                    // Custom double-click: comparing timestamps on self avoids
                    // the browser's dblclick element-identity requirement
                    var now = Date.now();
                    var isDbl = (now - (self._lastClickMs || 0) < 350 && self._lastClickCid === c.id);
                    self._lastClickMs  = now;
                    self._lastClickCid = c.id;
                    if (isDbl) self._startInlineEdit(c);
                };
            }(callout)));
            // Prevent dblclick from reaching Leaflet's zoom handler
            hit.addEventListener('dblclick', function (e) { e.stopPropagation(); e.preventDefault(); });
            hit.addEventListener('mousedown', (function (cid) {
                return function (e) {
                    if (e.button !== 0) return;
                    e.preventDefault(); e.stopPropagation();
                    self._selectCallout(cid); self._startBoxDrag(e, cid);
                };
            }(callout.id)));
            g.appendChild(hit);

            // ── Selection handles ─────────────────────────────────────
            if (isSelected) {
                // Blue  = anchor point
                this._appendHandle(g, ap.x, ap.y, '#1976d2', (function (cid) {
                    return function (e) { e.preventDefault(); e.stopPropagation(); self._startAnchorDrag(e, cid); };
                }(callout.id)));
                // Orange = box centre
                this._appendHandle(g, bx, by, '#f57c00', (function (cid) {
                    return function (e) { e.preventDefault(); e.stopPropagation(); self._startBoxDrag(e, cid); };
                }(callout.id)));
                // Purple squares = corner resize handles
                var corners = [
                    { x: bLeft,        y: bTop,        cur: 'nwse-resize' },
                    { x: bLeft + boxW, y: bTop,        cur: 'nesw-resize' },
                    { x: bLeft,        y: bTop + boxH, cur: 'nesw-resize' },
                    { x: bLeft + boxW, y: bTop + boxH, cur: 'nwse-resize' }
                ];
                for (var ci = 0; ci < corners.length; ci++) {
                    this._appendCornerHandle(g, corners[ci].x, corners[ci].y, corners[ci].cur, (function (cid) {
                        return function (e) { e.preventDefault(); e.stopPropagation(); self._startCornerResize(e, cid); };
                    }(callout.id)));
                }
            }

            return g;
        },

        _appendHandle: function (g, cx, cy, color, onMousedown) {
            var ring = this._svgEl('circle');
            ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', 8);
            ring.setAttribute('fill', 'white'); ring.setAttribute('stroke', color);
            ring.setAttribute('stroke-width', 2.5);
            ring.style.pointerEvents = 'all'; ring.style.cursor = 'grab';
            ring.addEventListener('mousedown', onMousedown); g.appendChild(ring);
            var dot = this._svgEl('circle');
            dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 4);
            dot.setAttribute('fill', color); dot.style.pointerEvents = 'none';
            g.appendChild(dot);
        },

        _appendCornerHandle: function (g, cx, cy, cursor, onMousedown) {
            var sq = this._svgEl('rect');
            sq.setAttribute('x', cx - 5); sq.setAttribute('y', cy - 5);
            sq.setAttribute('width', 10); sq.setAttribute('height', 10);
            sq.setAttribute('fill', 'white'); sq.setAttribute('stroke', '#7b1fa2');
            sq.setAttribute('stroke-width', 2);
            sq.style.pointerEvents = 'all'; sq.style.cursor = cursor;
            sq.addEventListener('mousedown', onMousedown); g.appendChild(sq);
        },

        _startBoxDrag: function (e, calloutId) {
            var callout = this._callouts.get(calloutId);
            if (!callout) return;
            this._map.dragging.disable();
            var startX = e.clientX, startY = e.clientY;
            var startOff = { x: callout.boxOffset.x, y: callout.boxOffset.y };
            var moved = false, self = this;
            function onMove(ev) {
                var dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (!moved && Math.hypot(dx, dy) > 2) moved = true;
                if (!moved) return;
                callout.boxOffset = { x: startOff.x + dx, y: startOff.y + dy };
                self._renderCallout(callout);
            }
            function onUp() {
                self._map.dragging.enable();
                if (moved) self._scheduleHistoryPush();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        },

        _startAnchorDrag: function (e, calloutId) {
            var callout = this._callouts.get(calloutId);
            if (!callout) return;
            this._map.dragging.disable();
            var mapRect = this._map.getContainer().getBoundingClientRect();
            var moved = false, self = this;
            function onMove(ev) {
                moved = true;
                var px = ev.clientX - mapRect.left, py = ev.clientY - mapRect.top;
                callout.anchorLatLng = self._map.containerPointToLatLng([px, py]);
                self._renderCallout(callout);
            }
            function onUp() {
                self._map.dragging.enable();
                if (moved) self._scheduleHistoryPush();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        },

        _startCornerResize: function (e, calloutId) {
            var callout = this._callouts.get(calloutId);
            if (!callout) return;
            this._map.dragging.disable();
            var mapRect = this._map.getContainer().getBoundingClientRect();
            var self = this, s = callout.style;
            if (!s.boxHeight) {
                var l0 = self._wrapText(callout.text || '', s.fontSize, s.boxWidth - s.padding * 2);
                s.boxHeight = Math.round(s.padding * 2 + l0.length * s.fontSize * 1.4);
            }
            function onMove(ev) {
                var ap = self._map.latLngToContainerPoint(callout.anchorLatLng);
                var px = ev.clientX - mapRect.left, py = ev.clientY - mapRect.top;
                s.boxWidth  = Math.max(60, Math.round(2 * Math.abs(px - (ap.x + callout.boxOffset.x))));
                s.boxHeight = Math.max(24, Math.round(2 * Math.abs(py - (ap.y + callout.boxOffset.y))));
                self._renderCallout(callout);
            }
            function onUp() {
                self._map.dragging.enable();
                self._scheduleHistoryPush();
                self.fire('calloutselect', { callout: callout });
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        },

        _startInlineEdit: function (callout) {
            var self = this, s = callout.style;
            var ap    = this._map.latLngToContainerPoint(callout.anchorLatLng);
            var bx    = ap.x + callout.boxOffset.x;
            var by    = ap.y + callout.boxOffset.y;
            var lines = this._wrapText(callout.text || '', s.fontSize, s.boxWidth - s.padding * 2);
            var boxW  = s.boxWidth;
            var boxH  = (s.boxHeight > 0) ? s.boxHeight : (s.padding * 2 + lines.length * s.fontSize * 1.4);
            var bLeft = bx - boxW / 2;
            var bTop  = by - boxH / 2;

            var group = this._svg.querySelector('[data-cid="' + callout.id + '"]');
            if (!group) return;

            // Hide SVG text so the transparent textarea shows through
            var textEl = group.querySelector('text');
            if (textEl) textEl.style.visibility = 'hidden';

            // foreignObject sits exactly over the text area inside the box
            var fo = this._svgEl('foreignObject');
            fo.setAttribute('x',     bLeft + s.padding);
            fo.setAttribute('y',     bTop  + s.padding);
            fo.setAttribute('width', boxW  - s.padding * 2);
            // Extra height so auto-growing text isn't clipped while typing
            fo.setAttribute('height', Math.max(boxH - s.padding * 2, s.fontSize * 2) + 400);
            fo.style.overflow      = 'visible';
            fo.style.pointerEvents = 'none';

            var ta = document.createElement('textarea');
            ta.value = callout.text || '';
            ta.style.cssText = [
                'display:block', 'width:100%', 'height:auto',
                'min-height:' + Math.round(s.fontSize * 1.4) + 'px',
                'background:transparent',
                'color:' + s.textColor,
                'font-size:' + s.fontSize + 'px',
                "font-family:system-ui,-apple-system,'Segoe UI',Arial,sans-serif",
                'line-height:1.4',
                'border:none', 'outline:none', 'resize:none', 'overflow:hidden',
                'padding:0', 'margin:0', 'box-sizing:border-box',
                'pointer-events:all', 'cursor:text', 'caret-color:' + s.textColor
            ].join(';');

            fo.appendChild(ta);
            group.appendChild(fo);

            this._editingCalloutId = callout.id;

            function autosize() {
                ta.style.height = 'auto';
                ta.style.height = ta.scrollHeight + 'px';
            }

            ta.addEventListener('input', function () {
                autosize();
                callout.text = ta.value;
            });

            // Defer focus so the SVG rendering settles first
            setTimeout(function () {
                ta.focus();
                ta.setSelectionRange(ta.value.length, ta.value.length);
                autosize();
            }, 0);

            var done = false;
            function commit() {
                if (done) return;
                done = true;
                self._editingCalloutId = null;
                callout.text = ta.value;
                fo.remove();
                if (textEl) textEl.style.visibility = '';
                self._renderCallout(callout);
                self._scheduleHistoryPush();
                self.fire('calloutselect', { callout: callout });
            }

            ta.addEventListener('blur', commit);
            ta.addEventListener('keydown', function (e) {
                e.stopPropagation();
                if (e.key === 'Escape') { callout.text = ta.value; commit(); }
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
            });
        },

        // Finds the point on the box border nearest to the anchor.
        _boxEdgePoint: function (anchor, bx, by, boxW, boxH) {
            var bLeft = bx - boxW / 2;
            var bTop  = by - boxH / 2;

            // Anchor inside box → return centre
            if (anchor.x > bLeft && anchor.x < bLeft + boxW &&
                anchor.y > bTop  && anchor.y < bTop  + boxH) {
                return { x: bx, y: by };
            }

            var dx = anchor.x - bx;
            var dy = anchor.y - by;
            var hw = boxW / 2;
            var hh = boxH / 2;

            var t = Infinity;
            if (dx > 0)  t = Math.min(t,  hw / dx);
            else if (dx < 0) t = Math.min(t, -hw / dx);
            if (dy > 0)  t = Math.min(t,  hh / dy);
            else if (dy < 0) t = Math.min(t, -hh / dy);

            return { x: bx + dx * t, y: by + dy * t };
        },

        _selectCallout: function (id) {
            // Skip re-render when already selected so the hitbox element stays
            // stable — required for custom double-click detection to work
            if (this._selectedId === id) {
                this.fire('calloutselect', { callout: this._callouts.get(id) });
                return;
            }
            var prevId = this._selectedId;
            this._selectedId = id;
            if (prevId !== null) {
                var prev = this._callouts.get(prevId);
                if (prev) this._renderCallout(prev);
            }
            var callout = this._callouts.get(id);
            if (callout) this._renderCallout(callout);
            this.fire('calloutselect', { callout: callout });
        },

        // Recreates the SVG arrowhead <marker> element for a callout.
        // Using markerUnits=userSpaceOnUse so arrowSize is always in screen pixels.
        // refX=10, refY=5 places the triangle tip exactly at the line endpoint.
        _setArrowMarker: function (id, color, size) {
            this._removeMarker(id);

            var marker = this._svgEl('marker');
            marker.setAttribute('id', id);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerUnits', 'userSpaceOnUse');
            marker.setAttribute('markerWidth',  size);
            marker.setAttribute('markerHeight', size);
            marker.setAttribute('orient', 'auto');

            var path = this._svgEl('path');
            path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
            path.setAttribute('fill', color);
            marker.appendChild(path);

            this._defs.appendChild(marker);
        },

        // Measures a text string at the given font size using an offscreen canvas.
        _measureText: function (text, fontSize) {
            if (!this._measureCanvas) {
                this._measureCanvas = document.createElement('canvas');
            }
            var ctx = this._measureCanvas.getContext('2d');
            ctx.font = fontSize + "px system-ui,-apple-system,'Segoe UI',Arial,sans-serif";
            return ctx.measureText(text).width;
        },

        // Wraps text at word boundaries to fit within maxWidth pixels.
        _wrapText: function (text, fontSize, maxWidth) {
            var paragraphs = text.split('\n');
            var result = [];
            for (var p = 0; p < paragraphs.length; p++) {
                var para = paragraphs[p];
                if (!para.length) { result.push(''); continue; }
                if (this._measureText(para, fontSize) <= maxWidth) {
                    result.push(para);
                    continue;
                }
                var words   = para.split(' ');
                var current = '';
                for (var w = 0; w < words.length; w++) {
                    var word = words[w];
                    var test = current ? current + ' ' + word : word;
                    if (this._measureText(test, fontSize) <= maxWidth) {
                        current = test;
                    } else {
                        if (current) result.push(current);
                        // Word alone wider than box — push it anyway
                        current = word;
                    }
                }
                if (current) result.push(current);
            }
            return result.length ? result : [''];
        },

        _removeMarker: function (id) {
            var existing = this._defs.querySelector('[id="' + id + '"]');
            if (existing) existing.remove();
        },

        _svgEl: function (tag) {
            return document.createElementNS('http://www.w3.org/2000/svg', tag);
        },

        // ── History & Persistence ─────────────────────────────────────

        _serialize: function () {
            var data = [];
            this._callouts.forEach(function (c) {
                data.push({
                    id:           c.id,
                    anchorLatLng: { lat: c.anchorLatLng.lat, lng: c.anchorLatLng.lng },
                    boxOffset:    { x: c.boxOffset.x, y: c.boxOffset.y },
                    text:         c.text,
                    style:        Object.assign({}, c.style)
                });
            });
            return { callouts: data, nextId: this._nextId };
        },

        _restoreFromSnapshot: function (snapshot) {
            var self = this;
            this._callouts.forEach(function (c) {
                var el = self._svg.querySelector('[data-cid="' + c.id + '"]');
                if (el) el.remove();
                self._removeMarker('callout-arrow-' + c.id);
                self._removeMarker('callout-clip-'  + c.id);
            });
            this._callouts.clear();
            this._selectedId = null;
            this._nextId     = snapshot.nextId || 1;
            (snapshot.callouts || []).forEach(function (d) {
                var c = {
                    id:           d.id,
                    anchorLatLng: L.latLng(d.anchorLatLng.lat, d.anchorLatLng.lng),
                    boxOffset:    { x: d.boxOffset.x, y: d.boxOffset.y },
                    text:         d.text,
                    style:        Object.assign({}, d.style)
                };
                self._callouts.set(d.id, c);
                self._renderCallout(c);
            });
            this.fire('calloutselect', { callout: null });
        },

        _pushHistory: function () {
            if (this._histTimer) { clearTimeout(this._histTimer); this._histTimer = null; }
            this._historyStack = this._historyStack.slice(0, this._historyIndex + 1);
            this._historyStack.push(this._serialize());
            if (this._historyStack.length > 50) this._historyStack.shift();
            else this._historyIndex++;
            this._emitHistoryState();
        },

        _scheduleHistoryPush: function () {
            var self = this;
            if (this._histTimer) clearTimeout(this._histTimer);
            this._histTimer = setTimeout(function () {
                self._pushHistory(); self._autoSave();
            }, 400);
        },

        _autoSave: function () {
            if (!this.options.storageKey) return;
            try { localStorage.setItem(this.options.storageKey, JSON.stringify(this._serialize())); } catch (e) {}
        },

        _emitHistoryState: function () {
            this.fire('historychange', { canUndo: this.canUndo(), canRedo: this.canRedo() });
        }

    });

    L.calloutLayer = function (options) {
        return new L.CalloutLayer(options);
    };

    return L.CalloutLayer;
}));
