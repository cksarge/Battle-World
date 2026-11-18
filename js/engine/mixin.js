// Installs the methods (and getters) of each source class on `target`'s prototype. Lets a big class
// keep its sections in separate files: each file is a plain class whose methods use `this` as usual.
export function mixin(target, ...sources) {
  for (const src of sources) {
    for (const key of Object.getOwnPropertyNames(src.prototype)) {
      if (key === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(target.prototype, key)) throw new Error(`${target.name}.${key} is defined twice`);
      Object.defineProperty(target.prototype, key, Object.getOwnPropertyDescriptor(src.prototype, key));
    }
  }
}
