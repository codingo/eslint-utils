/* globals BigInt */

import { findVariable } from "./find-variable"

const builtinNames = Object.freeze(
    new Set([
        "Array",
        "ArrayBuffer",
        "BigInt",
        "BigInt64Array",
        "BigUint64Array",
        "Boolean",
        "DataView",
        "Date",
        "decodeURI",
        "decodeURIComponent",
        "encodeURI",
        "encodeURIComponent",
        "escape",
        "Float32Array",
        "Float64Array",
        "Function",
        "Infinity",
        "Int16Array",
        "Int32Array",
        "Int8Array",
        "isFinite",
        "isNaN",
        "isPrototypeOf",
        "JSON",
        "Map",
        "Math",
        "NaN",
        "Number",
        "Object",
        "parseFloat",
        "parseInt",
        "Promise",
        "Proxy",
        "Reflect",
        "RegExp",
        "Set",
        "String",
        "Symbol",
        "Uint16Array",
        "Uint32Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "undefined",
        "unescape",
        "WeakMap",
        "WeakSet",
    ])
)
const callAllowed = new Set(
    [
        Array.isArray,
        typeof BigInt === "function" ? BigInt : undefined,
        Boolean,
        Date,
        Date.parse,
        decodeURI,
        decodeURIComponent,
        encodeURI,
        encodeURIComponent,
        escape,
        isFinite,
        isNaN,
        isPrototypeOf,
        ...Object.getOwnPropertyNames(Math)
            .map(k => Math[k])
            .filter(f => typeof f === "function"),
        Number,
        Number.isFinite,
        Number.isNaN,
        Number.parseFloat,
        Number.parseInt,
        Object,
        Object.entries, //eslint-disable-line @mysticatea/node/no-unsupported-features/es-builtins
        Object.is,
        Object.isExtensible,
        Object.isFrozen,
        Object.isSealed,
        Object.keys,
        Object.values, //eslint-disable-line @mysticatea/node/no-unsupported-features/es-builtins
        parseFloat,
        parseInt,
        RegExp,
        String,
        String.fromCharCode,
        String.fromCodePoint,
        String.raw,
        Symbol,
        Symbol.for,
        Symbol.keyFor,
        unescape,
    ].filter(f => typeof f === "function")
)
const callPassThrough = new Set([
    Object.freeze,
    Object.preventExtensions,
    Object.seal,
])

/**
 * Get the property descriptor.
 * @param {object} object The object to get.
 * @param {string|number|symbol} name The property name to get.
 */
function getPropertyDescriptor(object, name) {
    let x = object
    while ((typeof x === "object" || typeof x === "function") && x !== null) {
        const d = Object.getOwnPropertyDescriptor(x, name)
        if (d) {
            return d
        }
        x = Object.getPrototypeOf(x)
    }
    return null
}

/**
 * Check if a property is getter or not.
 * @param {object} object The object to check.
 * @param {string|number|symbol} name The property name to check.
 */
function isGetter(object, name) {
    const d = getPropertyDescriptor(object, name)
    return d != null && d.get != null
}

/**
 * Get the element values of a given node list.
 * @param {Node[]} nodeList The node list to get values.
 * @param {Scope|undefined} initialScope The initial scope to find variables.
 * @returns {any[]|null} The value list if all nodes are constant. Otherwise, null.
 */
function getElementValues(nodeList, initialScope) {
    const valueList = []

    for (let i = 0; i < nodeList.length; ++i) {
        const elementNode = nodeList[i]

        if (elementNode == null) {
            valueList.length = i + 1
        } else if (elementNode.type === "SpreadElement") {
            const argument = getStaticValueR(elementNode.argument, initialScope)
            if (argument == null) {
                return null
            }
            valueList.push(...argument.value)
        } else {
            const element = getStaticValueR(elementNode, initialScope)
            if (element == null) {
                return null
            }
            valueList.push(element.value)
        }
    }

    return valueList
}

const operations = Object.freeze({
    ArrayExpression(node, initialScope) {
        const elements = getElementValues(node.elements, initialScope)
        return elements != null ? { value: elements } : null
    },

    AssignmentExpression(node, initialScope) {
        if (node.operator === "=") {
            return getStaticValueR(node.right, initialScope)
        }
        return null
    },

    //eslint-disable-next-line complexity
    BinaryExpression(node, initialScope) {
        if (node.operator === "in" || node.operator === "instanceof") {
            // Not supported.
            return null
        }

        const left = getStaticValueR(node.left, initialScope)
        const right = getStaticValueR(node.right, initialScope)
        if (left != null && right != null) {
            switch (node.operator) {
                case "==":
                    return { value: left.value == right.value } //eslint-disable-line eqeqeq
                case "!=":
                    return { value: left.value != right.value } //eslint-disable-line eqeqeq
                case "===":
                    return { value: left.value === right.value }
                case "!==":
                    return { value: left.value !== right.value }
                case "<":
                    return { value: left.value < right.value }
                case "<=":
                    return { value: left.value <= right.value }
                case ">":
                    return { value: left.value > right.value }
                case ">=":
                    return { value: left.value >= right.value }
                case "<<":
                    return { value: left.value << right.value }
                case ">>":
                    return { value: left.value >> right.value }
                case ">>>":
                    return { value: left.value >>> right.value }
                case "+":
                    return { value: left.value + right.value }
                case "-":
                    return { value: left.value - right.value }
                case "*":
                    return { value: left.value * right.value }
                case "/":
                    return { value: left.value / right.value }
                case "%":
                    return { value: left.value % right.value }
                case "**":
                    return { value: Math.pow(left.value, right.value) }
                case "|":
                    return { value: left.value | right.value }
                case "^":
                    return { value: left.value ^ right.value }
                case "&":
                    return { value: left.value & right.value }

                // no default
            }
        }

        return null
    },

    CallExpression(node, initialScope) {
        const calleeNode = node.callee
        const args = getElementValues(node.arguments, initialScope)

        if (args != null) {
            if (calleeNode.type === "MemberExpression") {
                const object = getStaticValueR(calleeNode.object, initialScope)
                const property = calleeNode.computed
                    ? getStaticValueR(calleeNode.property, initialScope)
                    : { value: calleeNode.property.name }

                if (object != null && property != null) {
                    const receiver = object.value
                    const methodName = property.value
                    if (callAllowed.has(receiver[methodName])) {
                        return { value: receiver[methodName](...args) }
                    }
                    if (callPassThrough.has(receiver[methodName])) {
                        return { value: args[0] }
                    }
                }
            } else {
                const callee = getStaticValueR(calleeNode, initialScope)
                if (callee != null) {
                    const func = callee.value
                    if (callAllowed.has(func)) {
                        return { value: func(...args) }
                    }
                    if (callPassThrough.has(func)) {
                        return { value: args[0] }
                    }
                }
            }
        }

        return null
    },

    ConditionalExpression(node, initialScope) {
        const test = getStaticValueR(node.test, initialScope)
        if (test != null) {
            return test.value
                ? getStaticValueR(node.consequent, initialScope)
                : getStaticValueR(node.alternate, initialScope)
        }
        return null
    },

    ExpressionStatement(node, initialScope) {
        return getStaticValueR(node.expression, initialScope)
    },

    Identifier(node, initialScope) {
        if (initialScope != null) {
            const variable = findVariable(initialScope, node)

            // Built-in globals.
            if (
                variable != null &&
                variable.defs.length === 0 &&
                builtinNames.has(variable.name) &&
                variable.name in global
            ) {
                return { value: global[variable.name] }
            }

            // Constants.
            if (variable != null && variable.defs.length === 1) {
                const def = variable.defs[0]
                if (
                    def.parent &&
                    def.parent.kind === "const" &&
                    // TODO(mysticatea): don't support destructuring here.
                    def.node.id.type === "Identifier"
                ) {
                    return getStaticValueR(def.node.init, initialScope)
                }
            }
        }
        return null
    },

    Literal(node) {
        //istanbul ignore if : this is implementation-specific behavior.
        if ((node.regex != null || node.bigint != null) && node.value == null) {
            // It was a RegExp/BigInt literal, but Node.js didn't support it.
            return null
        }
        return { value: node.value }
    },

    LogicalExpression(node, initialScope) {
        const left = getStaticValueR(node.left, initialScope)
        if (left != null) {
            if (
                (node.operator === "||" && Boolean(left.value) === true) ||
                (node.operator === "&&" && Boolean(left.value) === false)
            ) {
                return left
            }

            const right = getStaticValueR(node.right, initialScope)
            if (right != null) {
                return right
            }
        }

        return null
    },

    MemberExpression(node, initialScope) {
        const object = getStaticValueR(node.object, initialScope)
        const property = node.computed
            ? getStaticValueR(node.property, initialScope)
            : { value: node.property.name }

        if (
            object != null &&
            property != null &&
            !isGetter(object.value, property.value)
        ) {
            return { value: object.value[property.value] }
        }
        return null
    },

    NewExpression(node, initialScope) {
        const callee = getStaticValueR(node.callee, initialScope)
        const args = getElementValues(node.arguments, initialScope)

        if (callee != null && args != null) {
            const Func = callee.value
            if (callAllowed.has(Func)) {
                return { value: new Func(...args) }
            }
        }

        return null
    },

    ObjectExpression(node, initialScope) {
        const object = {}

        for (const propertyNode of node.properties) {
            if (propertyNode.type === "Property") {
                if (propertyNode.kind !== "init") {
                    return null
                }
                const key = propertyNode.computed
                    ? getStaticValueR(propertyNode.key, initialScope)
                    : { value: propertyNode.key.name }
                const value = getStaticValueR(propertyNode.value, initialScope)
                if (key == null || value == null) {
                    return null
                }
                object[key.value] = value.value
            } else if (
                propertyNode.type === "SpreadElement" ||
                propertyNode.type === "ExperimentalSpreadProperty"
            ) {
                const argument = getStaticValueR(
                    propertyNode.argument,
                    initialScope
                )
                if (argument == null) {
                    return null
                }
                Object.assign(object, argument.value)
            } else {
                return null
            }
        }

        return { value: object }
    },

    SequenceExpression(node, initialScope) {
        const last = node.expressions[node.expressions.length - 1]
        return getStaticValueR(last, initialScope)
    },

    TaggedTemplateExpression(node, initialScope) {
        const tag = getStaticValueR(node.tag, initialScope)
        const expressions = getElementValues(
            node.quasi.expressions,
            initialScope
        )

        if (tag != null && expressions != null) {
            const func = tag.value
            const strings = node.quasi.quasis.map(q => q.value.cooked)
            strings.raw = node.quasi.quasis.map(q => q.value.raw)

            if (func === String.raw) {
                return { value: func(strings, ...expressions) }
            }
        }

        return null
    },

    TemplateLiteral(node, initialScope) {
        const expressions = getElementValues(node.expressions, initialScope)
        if (expressions != null) {
            let value = node.quasis[0].value.cooked
            for (let i = 0; i < expressions.length; ++i) {
                value += expressions[i]
                value += node.quasis[i + 1].value.cooked
            }
            return { value }
        }
        return null
    },

    UnaryExpression(node, initialScope) {
        if (node.operator === "delete") {
            // Not supported.
            return null
        }
        if (node.operator === "void") {
            return { value: undefined }
        }

        const arg = getStaticValueR(node.argument, initialScope)
        if (arg != null) {
            switch (node.operator) {
                case "-":
                    return { value: -arg.value }
                case "+":
                    return { value: +arg.value } //eslint-disable-line no-implicit-coercion
                case "!":
                    return { value: !arg.value }
                case "~":
                    return { value: ~arg.value }
                case "typeof":
                    return { value: typeof arg.value }

                // no default
            }
        }

        return null
    },
})

/**
 * Get the value of a given node if it's a static value.
 * @param {Node} node The node to get.
 * @param {Scope|undefined} initialScope The scope to start finding variable.
 * @returns {{value:any}|null} The static value of the node, or `null`.
 */
function getStaticValueR(node, initialScope) {
    if (node != null && Object.hasOwnProperty.call(operations, node.type)) {
        return operations[node.type](node, initialScope)
    }
    return null
}

/**
 * Get the value of a given node if it's a static value.
 * @param {Node} node The node to get.
 * @param {Scope} [initialScope] The scope to start finding variable. Optional. If this scope was given, this tries to resolve identifier references which are in the given node as much as possible.
 * @returns {{value:any}|null} The static value of the node, or `null`.
 */
export function getStaticValue(node, initialScope = null) {
    try {
        return getStaticValueR(node, initialScope)
    } catch (_error) {
        return null
    }
}
