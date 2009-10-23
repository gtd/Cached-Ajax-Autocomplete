/*
 *  CachedAjaxAutocomplete, v1.0
 *  (c) 2009 Gabe da Silveira
 *    based on
 *  Ajax Autocomplete for Prototype, version 1.0.3
 *  http://www.devbridge.com/projects/autocomplete/
 *  (c) 2008 Tomas Kirda
 *
 *  Ajax Autocomplete for Prototype is freely distributable under the terms of an MIT-style license.
 *
 *  CachedAjaxAutocomplete is a minor refactoring to enable some enhancements.
 *
 *  - Allow id to be passed as an option since the observed field is no longer constant
 *  - Allows the element the autocomplete is attached to to be changed
 *
 *  == Options
 *
 *  * `id` a unique identifier to identify the Autocomplete instance
 */

var CachedAjaxAutocomplete = function(el, options){
  this.options = {
    autoSubmit:false,
    minChars:1,
    maxHeight:null,
    deferRequestBy:null,
    width:0,
    container:null
  };
  if(options){ Object.extend(this.options, options); }

  this.el = $(el);
  this.id = options.id || this.el.identify(); // This is just a unique identifier, it is not specifically tied to the el.
  this.suggestions = [];
  this.data = [];
  this.badQueries = [];
  this.selectedIndex = -1;
  this.currentValue = null;
  this.intervalId = 0;
  this.cachedResponse = [];
  this.instanceId = null;
  this.onChangeInterval = null;
  this.ignoreValueChange = false;
  this.serviceUrl = options.serviceUrl;

  if(CachedAjaxAutocomplete.isDomLoaded){
    this.initialize();
  }else{
    Event.observe(document, 'dom:loaded', this.initialize.bind(this), false);
  }
};

CachedAjaxAutocomplete.instances = [];
CachedAjaxAutocomplete.isDomLoaded = false;

CachedAjaxAutocomplete.getInstance = function(id){
  var instances = CachedAjaxAutocomplete.instances;
  var i = instances.length;
  while(i--){ if(instances[i].id === id){ return instances[i]; }}
};

CachedAjaxAutocomplete.highlight = function(value, re){
  return value.replace(re, function(match){ return '<strong>' + match + '<\/strong>' });
};

CachedAjaxAutocomplete.prototype = {

  killerFn: null,

  initialize: function() {
    var me = this;
    this.killerFn = function(e) {
      if (!$(Event.element(e)).up('.autocomplete')) {
        me.killSuggestions();
        me.disableKillerFn();
      }
    } .bindAsEventListener(this);

    if (!this.options.width) { this.options.width = this.el.getWidth() - 2; }

    var div = new Element('div', { style: 'position:absolute;' });
    div.update('<div class="autocomplete-w1"><div class="autocomplete-w2"><div class="autocomplete" id="Autocomplete_' + this.id + '" style="display:none; width:' + this.options.width + 'px;"></div></div></div>');

    this.options.container = $(this.options.container);
    if (this.options.container) {
      this.options.container.appendChild(div);
      this.fixPosition = function() { };
    } else {
      document.body.appendChild(div);
    }

    this.mainContainerId = div.identify();
    this.container = $('Autocomplete_' + this.id);
    if(this.options.maxHeight) this.container.setStyle({ maxHeight: this.options.maxHeight + 'px' });

    this.setObservedElement(this.el);

    this.instanceId = CachedAjaxAutocomplete.instances.push(this) - 1;
  },

  setObservedElement: function(el) {
    this.el = $(el);
    this.el.setAttribute('autocomplete','off');
    this.currentValue = this.el.value;

    this.fixPosition();

    if(this.boundKeyPressObserver) {
      Event.stopObserving(this.el, window.opera ? 'keypress':'keydown', this.boundKeyPressObserver);
      Event.stopObserving(this.el, 'keyup', this.boundKeyUpObserver);
      Event.stopObserving(this.el, 'blur', this.boundBlurObserver);
      Event.stopObserving(this.el, 'focus', this.boundFocusObserver);
    }

    this.boundKeyPressObserver = this.onKeyPress.bind(this);
    this.boundKeyUpObserver = this.onKeyUp.bind(this);
    this.boundBlurObserver = this.enableKillerFn.bind(this);
    this.boundFocusObserver = this.fixPosition.bind(this);

    Event.observe(this.el, window.opera ? 'keypress':'keydown', this.boundKeyPressObserver);
    Event.observe(this.el, 'keyup', this.boundKeyUpObserver);
    Event.observe(this.el, 'blur', this.boundBlurObserver);
    Event.observe(this.el, 'focus', this.boundFocusObserver);
  },

  fixPosition: function() {
    var offset = this.el.cumulativeOffset();
    $(this.mainContainerId).setStyle({ top: (offset.top + this.el.getHeight()) + 'px', left: offset.left + 'px' });
  },

  enableKillerFn: function() {
    Event.observe(document.body, 'click', this.killerFn);
  },

  disableKillerFn: function() {
    Event.stopObserving(document.body, 'click', this.killerFn);
  },

  killSuggestions: function() {
    this.stopKillSuggestions();
    this.intervalId = window.setInterval(function() { this.hide(); this.stopKillSuggestions(); } .bind(this), 300);
  },

  stopKillSuggestions: function() {
    window.clearInterval(this.intervalId);
  },

  onKeyPress: function(e) {
    if (!this.enabled) { return; }
    // return will exit the function
    // and event will not fire
    switch (e.keyCode) {
      case Event.KEY_ESC:
        this.el.value = this.currentValue;
        this.hide();
        break;
      case Event.KEY_TAB:
      case Event.KEY_RETURN:
        if (this.selectedIndex === -1) {
          this.hide();
          return;
        }
        this.select(this.selectedIndex);
        if (e.keyCode === Event.KEY_TAB) { return; }
        break;
      case Event.KEY_UP:
        this.moveUp();
        break;
      case Event.KEY_DOWN:
        this.moveDown();
        break;
      default:
        return;
    }
    Event.stop(e);
  },

  onKeyUp: function(e) {
    switch (e.keyCode) {
      case Event.KEY_UP:
      case Event.KEY_DOWN:
        return;
    }
    clearInterval(this.onChangeInterval);
    if (this.currentValue !== this.el.value) {
      if (this.options.deferRequestBy > 0) {
        // Defer lookup in case when value changes very quickly:
        this.onChangeInterval = setInterval((function() {
          this.onValueChange();
        }).bind(this), this.options.deferRequestBy);
      } else {
        this.onValueChange();
      }
    }
  },

  onValueChange: function() {
    clearInterval(this.onChangeInterval);
    this.currentValue = this.el.value;
    this.selectedIndex = -1;
    if (this.ignoreValueChange) {
      this.ignoreValueChange = false;
      return;
    }
    if (this.currentValue === '' || this.currentValue.length < this.options.minChars) {
      this.hide();
    } else {
      this.getSuggestions();
    }
  },

  getSuggestions: function() {
    var cr = this.cachedResponse[this.currentValue];
    if (cr && Object.isArray(cr.suggestions)) {
      this.suggestions = cr.suggestions;
      this.data = cr.data;
      this.suggest();
    } else if (!this.isBadQuery(this.currentValue)) {
      this.el.addClassName('autocomplete_indicator');
      new Ajax.Request(this.serviceUrl, {
        parameters: { query: this.currentValue },
        onComplete: this.processResponse.bind(this),
        method: 'get'
      });
    }
  },

  isBadQuery: function(q) {
    var i = this.badQueries.length;
    while (i--) {
      if (q.indexOf(this.badQueries[i]) === 0) { return true; }
    }
    return false;
  },

  hide: function() {
    this.enabled = false;
    this.selectedIndex = -1;
    this.container.hide();
  },

  suggest: function() {
    if (this.suggestions.length === 0) {
      this.hide();
      return;
    }
    var content = [];
    var re = new RegExp('\\b' + this.currentValue.match(/\w+/g).join('|\\b'), 'gi');
    this.suggestions.each(function(value, i) {
      content.push((this.selectedIndex === i ? '<div class="selected"' : '<div'), ' title="', value, '" onclick="CachedAjaxAutocomplete.instances[', this.instanceId, '].select(', i, ');" onmouseover="CachedAjaxAutocomplete.instances[', this.instanceId, '].activate(', i, ');">', CachedAjaxAutocomplete.highlight(value, re), '</div>');
    } .bind(this));
    this.enabled = true;
    this.container.update(content.join('')).show();
  },

  processResponse: function(xhr) {
    var response;
    try {
      response = xhr.responseText.evalJSON();
      if (!Object.isArray(response.data)) { response.data = []; }
    } catch (err) { return; }
    this.suggestions = response.suggestions;
    this.data = response.data;
    this.cachedResponse[response.query] = response;
    if (response.suggestions.length === 0) { this.badQueries.push(response.query); }
    if (response.query === this.currentValue) { this.suggest(); }
    this.el.removeClassName('autocomplete_indicator');
  },

  activate: function(index) {
    var divs = this.container.childNodes;
    var activeItem;
    // Clear previous selection:
    if (this.selectedIndex !== -1 && divs.length > this.selectedIndex) {
      divs[this.selectedIndex].className = '';
    }
    this.selectedIndex = index;
    if (this.selectedIndex !== -1 && divs.length > this.selectedIndex) {
      activeItem = divs[this.selectedIndex]
      activeItem.className = 'selected';
    }
    return activeItem;
  },

  deactivate: function(div, index) {
    div.className = '';
    if (this.selectedIndex === index) { this.selectedIndex = -1; }
  },

  select: function(i) {
    var selectedValue = this.suggestions[i];
    if (selectedValue) {
      this.el.value = selectedValue;
      if (this.options.autoSubmit && this.el.form) {
        this.el.form.submit();
      }
      this.ignoreValueChange = true;
      this.hide();
      this.onSelect(i);
    }
  },

  moveUp: function() {
    if (this.selectedIndex === -1) { return; }
    if (this.selectedIndex === 0) {
      this.container.childNodes[0].className = '';
      this.selectedIndex = -1;
      this.el.value = this.currentValue;
      return;
    }
    this.adjustScroll(this.selectedIndex - 1);
  },

  moveDown: function() {
    if (this.selectedIndex === (this.suggestions.length - 1)) { return; }
    this.adjustScroll(this.selectedIndex + 1);
  },

  adjustScroll: function(i) {
    var container = this.container;
    var activeItem = this.activate(i);

    if(this.options.maxHeight) {
      var offsetTop = activeItem.offsetTop;
      var upperBound = container.scrollTop;
      var lowerBound = upperBound + this.options.maxHeight - 25;

      if (offsetTop < upperBound) {
        container.scrollTop = offsetTop;
      } else if (offsetTop > lowerBound) {
        container.scrollTop = offsetTop - this.options.maxHeight + 25;
      }
    }

    this.el.value = this.suggestions[i];
  },

  onSelect: function(i) {
    (this.options.onSelect || Prototype.emptyFunction)(this.suggestions[i], this.data[i]);
  }

};

Event.observe(document, 'dom:loaded', function(){ CachedAjaxAutocomplete.isDomLoaded = true; }, false);
