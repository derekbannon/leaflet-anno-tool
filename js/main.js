(function () {
    'use strict';

    // ── Map setup ─────────────────────────────────────────────────────
    var map = L.map('map', {
        center: [51.505, -0.09],
        zoom: 13,
        zoomControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // ── Callout layer ─────────────────────────────────────────────────
    var calloutLayer = L.calloutLayer({ storageKey: 'leaflet-callout-demo' }).addTo(map);

    // ── DOM refs ──────────────────────────────────────────────────────
    var btnSelect      = document.getElementById('btn-select');
    var btnAddCallout  = document.getElementById('btn-add-callout');
    var btnDelete      = document.getElementById('btn-delete');
    var btnUndo        = document.getElementById('btn-undo');
    var btnRedo        = document.getElementById('btn-redo');
    var propsPanel     = document.getElementById('props-panel');
    var btnCloseProps  = document.getElementById('btn-close-props');
    var toolbarStatus  = document.getElementById('toolbar-status');
    var hintEl         = document.getElementById('hint-text');

    var propText         = document.getElementById('prop-text');
    var propFontSize     = document.getElementById('prop-font-size');
    var propTextColor    = document.getElementById('prop-text-color');
    var propBgColor      = document.getElementById('prop-bg-color');
    var propBorderColor  = document.getElementById('prop-border-color');
    var propBorderWidth  = document.getElementById('prop-border-width');
    var propPadding      = document.getElementById('prop-padding');
    var propBoxWidth     = document.getElementById('prop-box-width');
    var propBoxHeight    = document.getElementById('prop-box-height');
    var propCornerRadius = document.getElementById('prop-corner-radius');
    var propArrowColor   = document.getElementById('prop-arrow-color');
    var propArrowWidth   = document.getElementById('prop-arrow-width');
    var propArrowSize    = document.getElementById('prop-arrow-size');
    var propLeaderStyle  = document.getElementById('prop-leader-style');
    var propElbowLength  = document.getElementById('prop-elbow-length');
    var elbowLengthRow   = document.getElementById('elbow-length-row');
    var importFile       = document.getElementById('import-file');

    var currentMode = 'select';

    // ── Mode management ───────────────────────────────────────────────
    function setMode(mode) {
        currentMode = mode;
        calloutLayer.setMode(mode);

        btnSelect.classList.toggle('active', mode === 'select');
        btnAddCallout.classList.toggle('active', mode === 'add');

        if (mode === 'add') {
            toolbarStatus.textContent = 'Click on the map to place a callout';
            hintEl.textContent = 'Click to place  •  Esc to cancel';
        } else {
            toolbarStatus.textContent = calloutLayer.getSelected()
                ? 'Drag handles to reposition  •  Edit properties on the right'
                : 'Click a callout to select it, or press C to add one';
            hintEl.textContent = '';
        }
    }

    // ── Properties panel ─────────────────────────────────────────────
    function showProps(callout) {
        if (!callout) {
            propsPanel.classList.add('hidden');
            btnDelete.disabled = true;
            return;
        }

        propsPanel.classList.remove('hidden');
        btnDelete.disabled = false;

        var s = callout.style;
        propText.value         = callout.text || '';
        propFontSize.value     = s.fontSize;
        propTextColor.value    = s.textColor;
        propBgColor.value      = s.bgColor;
        propBorderColor.value  = s.borderColor;
        propBorderWidth.value  = s.borderWidth;
        propPadding.value      = s.padding;
        propBoxWidth.value     = s.boxWidth;
        propBoxHeight.value    = s.boxHeight || 0;
        propCornerRadius.value = s.cornerRadius;
        propArrowColor.value   = s.arrowColor;
        propArrowWidth.value   = s.arrowWidth;
        propArrowSize.value    = s.arrowSize;
        propLeaderStyle.value  = s.leaderStyle  || 'elbow';
        propElbowLength.value  = s.elbowLength  || 20;
        elbowLengthRow.style.display = (propLeaderStyle.value === 'elbow') ? '' : 'none';
    }

    function collectStyle() {
        return {
            fontSize:     parseFloat(propFontSize.value)     || 14,
            textColor:    propTextColor.value,
            bgColor:      propBgColor.value,
            borderColor:  propBorderColor.value,
            borderWidth:  parseFloat(propBorderWidth.value)  || 1.5,
            padding:      parseFloat(propPadding.value)      || 10,
            boxWidth:     parseFloat(propBoxWidth.value)     || 160,
            boxHeight:    parseFloat(propBoxHeight.value)    || 0,
            cornerRadius: parseFloat(propCornerRadius.value) || 4,
            arrowColor:   propArrowColor.value,
            arrowWidth:   parseFloat(propArrowWidth.value)   || 2,
            arrowSize:    parseFloat(propArrowSize.value)    || 12,
            leaderStyle:  propLeaderStyle.value,
            elbowLength:  parseFloat(propElbowLength.value)  || 20
        };
    }

    // ── Toolbar buttons ───────────────────────────────────────────────
    btnSelect.addEventListener('click', function () { setMode('select'); });
    btnAddCallout.addEventListener('click', function () { setMode('add'); });
    btnDelete.addEventListener('click', function () { calloutLayer.deleteSelected(); });
    btnCloseProps.addEventListener('click', function () { calloutLayer.deselect(); });
    btnUndo.addEventListener('click', function () { calloutLayer.undo(); });
    btnRedo.addEventListener('click', function () { calloutLayer.redo(); });

    document.getElementById('btn-export').addEventListener('click', function () {
        calloutLayer.exportJSON();
    });
    importFile.addEventListener('change', function () {
        var file = this.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) { calloutLayer.importJSON(e.target.result); };
        reader.readAsText(file);
        this.value = '';
    });

    // ── Callout selection event ───────────────────────────────────────
    calloutLayer.on('calloutselect', function (e) {
        showProps(e.callout);
        if (e.callout) {
            if (currentMode === 'add') setMode('select');
        } else {
            setMode('select');
        }
    });

    calloutLayer.on('historychange', function (e) {
        btnUndo.disabled = !e.canUndo;
        btnRedo.disabled = !e.canRedo;
    });

    // ── Properties inputs → live update ───────────────────────────────
    propText.addEventListener('input', function () {
        calloutLayer.updateSelected({ text: propText.value });
    });
    propLeaderStyle.addEventListener('change', function () {
        elbowLengthRow.style.display = (this.value === 'elbow') ? '' : 'none';
        calloutLayer.updateSelected({ style: collectStyle() });
    });

    function onStyleInput() {
        calloutLayer.updateSelected({ style: collectStyle() });
    }

    [
        propFontSize, propTextColor, propBgColor, propBorderColor,
        propBorderWidth, propPadding, propBoxWidth, propBoxHeight,
        propCornerRadius, propArrowColor, propArrowWidth, propArrowSize,
        propElbowLength
    ].forEach(function (el) {
        el.addEventListener('input', onStyleInput);
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); calloutLayer.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); calloutLayer.redo(); return; }
        switch (e.key) {
            case 'Escape':
                if (currentMode === 'add') setMode('select');
                else calloutLayer.deselect();
                break;
            case 'Delete': case 'Backspace': calloutLayer.deleteSelected(); break;
            case 'v': case 'V': setMode('select'); break;
            case 'c': case 'C': setMode('add'); break;
        }
    });

    // ── Initial state ─────────────────────────────────────────────────
    setMode('select');

}());
