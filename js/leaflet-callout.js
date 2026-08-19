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
                boxHeight:    0,   // 0 = auto-fit text
                cornerRadius: 4
            }
        },

        initialize: function (options) {
            L.setOptions(this, options);
            this._callouts   = new Map();
            this._nextId     = 1;
            this._selectedId = null;
            this._mode       = 'select';
        },

        onAdd: function (map) {
            this._map = map;
            this._svg = this._createSVG();
            map.getContainer().appendChild(this._svg);
            map.on('move zoom', this._redrawAll, this);
            this._containerClickHandler = this._onContainerClick.bind(this);
            map.getContainer().addEventListener('click', this._containerClickHandler);
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
            this._callouts.delete(id);
            this.fire('calloutselect', { callout: null });
        },

        updateSelected: function (changes) {
            if (this._selectedId === null) return;
            var callout = this._callouts.get(this._selectedId);
            if (!callout) return;
            if (changes.text !== undefined) callout.text = changes.text;
            if (changes.style) Object.assign(callout.style, changes.style);
            this._renderCallout(callout);
        },

        getSelected: function () {
            return this._selectedId !== null ? this._callouts.get(this._selectedId) : null;
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
            this._callouts.forEach(function (c) { self._renderCallout(c); });
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
            var s = callout.style;
            var bx = ap.x + callout.boxOffset.x;
            var by = ap.y + callout.boxOffset.y;

            // Word-wrap text to fit inside the box, then compute box height
            var lineH    = s.fontSize * 1.4;
            var boxW     = s.boxWidth;
            var innerW   = boxW - s.padding * 2;
            var lines    = this._wrapText(callout.text || '', s.fontSize, innerW);
            var autoH    = s.padding * 2 + lines.length * lineH;
            var boxH     = (s.boxHeight > 0) ? s.boxHeight : autoH;
            var bLeft    = bx - boxW / 2;
            var bTop     = by - boxH / 2;

            var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('data-cid', callout.id);

            // ── Arrow marker ──────────────────────────────────────────
            var markerId = 'callout-arrow-' + callout.id;
            this._setArrowMarker(markerId, s.arrowColor, s.arrowSize);

            // ── Leader line ───────────────────────────────────────────
            var ep   = this._boxEdgePoint(ap, bx, by, boxW, boxH);
            var dist = Math.hypot(ap.x - ep.x, ap.y - ep.y);

            if (dist > s.arrowSize * 0.6) {
                var leader = this._svgEl('line');
                leader.setAttribute('x1', ep.x);
                leader.setAttribute('y1', ep.y);
                leader.setAttribute('x2', ap.x);
                leader.setAttribute('y2', ap.y);
                leader.setAttribute('stroke', s.arrowColor);
                leader.setAttribute('stroke-width', s.arrowWidth);
                leader.setAttribute('marker-end', 'url(#' + markerId + ')');
                g.appendChild(leader);

                // Small circle at the box-edge attach point
                var dot = this._svgEl('circle');
                dot.setAttribute('cx', ep.x);
                dot.setAttribute('cy', ep.y);
                dot.setAttribute('r', s.arrowWidth + 1);
                dot.setAttribute('fill', s.arrowColor);
                g.appendChild(dot);
            }

            // ── Box background ────────────────────────────────────────
            var box = this._svgEl('rect');
            box.setAttribute('x', bLeft);
            box.setAttribute('y', bTop);
            box.setAttribute('width', boxW);
            box.setAttribute('height', boxH);
            box.setAttribute('rx', s.cornerRadius);
            box.setAttribute('fill', s.bgColor);
            box.setAttribute('stroke', isSelected ? '#1976d2' : s.borderColor);
            box.setAttribute('stroke-width', isSelected ? Math.max(s.borderWidth, 2.5) : s.borderWidth);
            if (isSelected) {
                box.setAttribute('filter', 'drop-shadow(0 2px 8px rgba(25,118,210,0.45))');
            }
            g.appendChild(box);

            // ── Clip text to box when height is fixed ─────────────────
            var clipId = 'callout-clip-' + callout.id;
            this._removeMarker(clipId);
            if (s.boxHeight > 0) {
                var clipPath = this._svgEl('clipPath');
                clipPath.setAttribute('id', clipId);
                var clipRect = this._svgEl('rect');
                clipRect.setAttribute('x', bLeft + 1);
                clipRect.setAttribute('y', bTop + 1);
                clipRect.setAttribute('width',  boxW - 2);
                clipRect.setAttribute('height', boxH - 2);
                clipPath.appendChild(clipRect);
                this._defs.appendChild(clipPath);
            }

            // ── Text ──────────────────────────────────────────────────
            var textEl = this._svgEl('text');
            textEl.setAttribute('font-family', "system-ui,-apple-system,'Segoe UI',Arial,sans-serif");
            textEl.setAttribute('font-size', s.fontSize);
            textEl.setAttribute('fill', s.textColor);
            textEl.style.pointerEvents = 'none';
            textEl.style.userSelect    = 'none';
            if (s.boxHeight > 0) {
                textEl.setAttribute('clip-path', 'url(#' + clipId + ')');
            }

            for (var i = 0; i < lines.length; i++) {
                var tspan = this._svgEl('tspan');
                tspan.setAttribute('x', bLeft + s.padding);
                tspan.setAttribute('y', bTop + s.padding + s.fontSize + i * lineH);
                tspan.textContent = lines[i].length ? lines[i] : '\u00A0';
                textEl.appendChild(tspan);
            }
            g.appendChild(textEl);

            // ── Hit area for mouse events ─────────────────────────────
            var self = this;
            var hit = this._svgEl('rect');
            hit.setAttribute('x', bLeft);
            hit.setAttribute('y', bTop);
            hit.setAttribute('width', boxW);
            hit.setAttribute('height', boxH);
            hit.setAttribute('fill', 'transparent');
            hit.style.pointerEvents = 'all';
            hit.style.cursor        = 'move';

            hit.addEventListener('click', function (e) {
                e.stopPropagation();
            });
            hit.addEventListener('mousedown', (function (cid) {
                return function (e) {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    self._selectCallout(cid);
                    self._startBoxDrag(e, cid);
                };
            }(callout.id)));
            g.appendChild(hit);

            // ── Selection handles ────────────────────────────────────
            if (isSelected) {
                // Blue handle = anchor point (moves the arrow tip on the map)
                this._appendHandle(g, ap.x, ap.y, '#1976d2', (function (cid) {
                    return function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._startAnchorDrag(e, cid);
                    };
                }(callout.id)));

                // Orange handle = box center (repositions the callout box)
                this._appendHandle(g, bx, by, '#f57c00', (function (cid) {
                    return function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        self._startBoxDrag(e, cid);
                    };
                }(callout.id)));
            }

            return g;
        },

        _appendHandle: function (g, cx, cy, color, onMousedown) {
            var ring = this._svgEl('circle');
            ring.setAttribute('cx', cx);
            ring.setAttribute('cy', cy);
            ring.setAttribute('r', 8);
            ring.setAttribute('fill', 'white');
            ring.setAttribute('stroke', color);
            ring.setAttribute('stroke-width', 2.5);
            ring.style.pointerEvents = 'all';
            ring.style.cursor        = 'grab';
            ring.addEventListener('mousedown', onMousedown);
            g.appendChild(ring);

            var dot = this._svgEl('circle');
            dot.setAttribute('cx', cx);
            dot.setAttribute('cy', cy);
            dot.setAttribute('r', 4);
            dot.setAttribute('fill', color);
            dot.style.pointerEvents = 'none';
            g.appendChild(dot);
        },

        _startBoxDrag: function (e, calloutId) {
            var callout = this._callouts.get(calloutId);
            if (!callout) return;

            this._map.dragging.disable();
            var startX = e.clientX;
            var startY = e.clientY;
            var startOff = { x: callout.boxOffset.x, y: callout.boxOffset.y };
            var moved = false;
            var self = this;

            function onMove(ev) {
                var dx = ev.clientX - startX;
                var dy = ev.clientY - startY;
                if (!moved && Math.hypot(dx, dy) > 2) moved = true;
                if (!moved) return;
                callout.boxOffset = { x: startOff.x + dx, y: startOff.y + dy };
                self._renderCallout(callout);
            }

            function onUp() {
                self._map.dragging.enable();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        },

        _startAnchorDrag: function (e, calloutId) {
            var callout = this._callouts.get(calloutId);
            if (!callout) return;

            this._map.dragging.disable();
            var mapRect = this._map.getContainer().getBoundingClientRect();
            var self = this;

            function onMove(ev) {
                var px = ev.clientX - mapRect.left;
                var py = ev.clientY - mapRect.top;
                callout.anchorLatLng = self._map.containerPointToLatLng([px, py]);
                self._renderCallout(callout);
            }

            function onUp() {
                self._map.dragging.enable();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        },

        // Finds the point on the box border nearest to the anchor, along the
        // ray from the box centre toward the anchor.
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
            var prevId = this._selectedId;
            this._selectedId = id;

            if (prevId !== null && prevId !== id) {
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
        }

    });

    L.calloutLayer = function (options) {
        return new L.CalloutLayer(options);
    };

    return L.CalloutLayer;
}));
