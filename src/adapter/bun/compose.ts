import { mapEarlyResponse } from './handler'
import { sucrose, type Sucrose } from '../../sucrose'
import { createHoc, createOnRequestHandler, isAsync } from '../../compose'

import { randomId, ELYSIA_REQUEST_ID, redirect, isNotEmpty } from '../../utils'
import { status } from '../../error'
import { ELYSIA_TRACE } from '../../trace'

import type { AnyElysia } from '../..'
import type { InternalRoute, InputSchema } from '../../types'

/**
 * Conditionally includes a string value if a condition is met.
 * Used for optimizing generated code by omitting unused parts.
 */
const allocateIf = (value: string, condition: unknown): string =>
	condition ? value : ''

/**
 * Generates the query index calculation code.
 * This extracts the query string index from the URL for efficient parsing.
 */
const generateQueryIndexCode = (standardHostname: boolean): string => {
	const urlStartOffset = standardHostname ? 11 : 7
	return (
		`const u=request.url,` +
		`s=u.indexOf('/',${urlStartOffset}),` +
		`qi=u.indexOf('?', s + 1)\n`
	)
}

/**
 * Generates the path property code for the context object.
 * Handles both static and dynamic routes efficiently.
 */
const generatePathCode = (
	route: InternalRoute,
	inference: Sucrose.Inference,
	needsQuery: boolean,
	standardHostname: boolean | undefined
): string => {
	if (!inference.path) return ''

	const isDynamic = /[:*]/.test(route.path)

	if (!isDynamic) {
		return `path:'${route.path}',`
	}

	// For dynamic routes, use a getter to lazily compute the path
	const queryIndexCode = needsQuery ? '' : generateQueryIndexCode(standardHostname ?? true)
	return (
		`get path(){` +
		queryIndexCode +
		`if(qi===-1)return u.substring(s)\n` +
		`return u.substring(s,qi)\n` +
		`},`
	)
}

/**
 * Generates code for decorators to be included in the context.
 */
const generateDecoratorsCode = (app: AnyElysia): string => {
	// @ts-expect-error private
	const decoratorKeys = Object.keys(app.singleton.decorator)
	
	if (decoratorKeys.length === 0) return ''

	return decoratorKeys
		.map((key) => `,'${key}':decorator['${key}']`)
		.join('')
}

/**
 * Creates the context object literal code for the route handler.
 * This context is passed to route handlers and contains request data,
 * utilities, and app state.
 */
const createContext = (
	app: AnyElysia,
	route: InternalRoute,
	inference: Sucrose.Inference,
	isInline = false
): string => {
	const hasTrace = !!app.event.trace?.length
	const isDynamic = /[:*]/.test(route.path)
	const standardHostname = (app.config.handler?.standardHostname ?? true) as boolean

	// @ts-expect-error private
	const defaultHeaders = app.setHeaders

	// Determine if query parsing is needed
	const needsQuery =
		inference.query ||
		!!route.hooks.query ||
		!!(route.hooks.standaloneValidator as InputSchema[])?.find(
			(x) => x.query
		) ||
		app.event.request?.length

	// Build context object code
	const parts: string[] = []

	// Add trace ID if tracing is enabled
	if (hasTrace) {
		parts.push(`const id=randomId()\n`)
	}

	// Add query index calculation if needed
	if (needsQuery) {
		parts.push(generateQueryIndexCode(standardHostname))
	}

	// Start context object
	const contextStart = isInline ? '{' : 'const c={\n'
	parts.push(contextStart)

	// Core context properties
	const contextProperties: string[] = [
		'request,',
		'store,',
		allocateIf('qi,', needsQuery),
		allocateIf('params:request.params,', isDynamic),
		generatePathCode(route, inference, needsQuery, standardHostname),
		allocateIf(
			'url:request.url,',
			hasTrace || inference.url || needsQuery
		),
		'redirect,',
		'status,',
		`set:{headers:` +
			(isNotEmpty(defaultHeaders)
				? 'Object.assign({},app.setHeaders)'
				: 'Object.create(null)') +
			`,status:200}`
	]

	parts.push(contextProperties.join(''))

	// Add server getter if needed
	if (inference.server) {
		parts.push(`,get server(){return app.getServer()}`)
	}

	// Add trace ID to context if tracing is enabled
	if (hasTrace) {
		parts.push(',[ELYSIA_REQUEST_ID]:id')
	}

	// Add decorators
	parts.push(generateDecoratorsCode(app))

	// Close context object
	parts.push('}\n')

	return parts.join('')
}

/**
 * Generates the variable declarations for the route handler function.
 * These variables are extracted from the data object passed to the function.
 */
const generateVariableDeclarations = (
	hasTrace: boolean,
	hasHoc: boolean,
	hasOnRequest: boolean
): string => {
	const declarations: string[] = [
		'const handler=data.handler,',
		'app=data.app,',
		'store=data.store,',
		'decorator=data.decorator,',
		'redirect=data.redirect,',
		'route=data.route,',
		'mapEarlyResponse=data.mapEarlyResponse,',
		allocateIf('randomId=data.randomId,', hasTrace),
		allocateIf('ELYSIA_REQUEST_ID=data.ELYSIA_REQUEST_ID,', hasTrace),
		allocateIf('ELYSIA_TRACE=data.ELYSIA_TRACE,', hasTrace),
		allocateIf('trace=data.trace,', hasTrace),
		allocateIf('hoc=data.hoc,', hasHoc),
		'status=data.status\n'
	]

	return declarations.join('')
}

/**
 * Determines if query parsing is needed for a route.
 */
const needsQueryParsing = (
	inference: Sucrose.Inference,
	route: InternalRoute
): boolean => {
	return (
		inference.query ||
		!!route.hooks.query ||
		!!(route.hooks.standaloneValidator as InputSchema[])?.find(
			(x) => x.query
		)
	)
}

/**
 * Creates an optimized route handler for Bun.
 * This function generates highly optimized JavaScript code as a string
 * and compiles it into a function for maximum performance.
 */
export const createBunRouteHandler = (
	app: AnyElysia,
	route: InternalRoute
) => {
	const hasTrace = !!app.event.trace?.length
	// @ts-expect-error private property
	const hasHoc = !!app.extender.higherOrderFunctions.length
	const hasOnRequest = !!app.event.request?.length

	// Infer what properties are needed from the route hooks and handler
	// @ts-expect-error private property
	let inference = sucrose(route.hooks, app.inference)
	inference = sucrose({ handler: route.handler }, inference)

	// Build the function literal
	const codeParts: string[] = []

	// Variable declarations
	codeParts.push(
		generateVariableDeclarations(hasTrace, hasHoc, hasOnRequest)
	)

	// OnRequest handler array if needed
	if (hasOnRequest) {
		codeParts.push(`const onRequest=app.event.request.map(x=>x.fn)\n`)
	}

	// Function signature (async if needed)
	const isAsyncHandler = app.event.request?.find(isAsync)
	const functionSignature = `${isAsyncHandler ? 'async' : ''} function map(request){`
	codeParts.push(functionSignature)

	// Determine if we need full context creation or inline context
	const needsQuery = needsQueryParsing(inference, route)
	const needsFullContext = hasTrace || needsQuery || hasOnRequest

	if (needsFullContext) {
		// Full context with onRequest handling
		codeParts.push(createContext(app, route, inference))
		codeParts.push(createOnRequestHandler(app))
		codeParts.push('return handler(c)}')
	} else {
		// Inline context for maximum performance
		const inlineContext = createContext(app, route, inference, true)
		codeParts.push(`return handler(${inlineContext})}`)
	}

	// Add higher-order function wrapper if needed
	codeParts.push(createHoc(app))

	// Compile and return the handler function
	const handlerFunction = Function('data', codeParts.join(''))

	return handlerFunction({
		app,
		handler: route.compile?.() ?? route.composed,
		redirect,
		status,
		// @ts-expect-error private property
		hoc: app.extender.higherOrderFunctions.map((x) => x.fn),
		store: app.store,
		decorator: app.decorator,
		route: route.path,
		randomId: hasTrace ? randomId : undefined,
		ELYSIA_TRACE: hasTrace ? ELYSIA_TRACE : undefined,
		ELYSIA_REQUEST_ID: hasTrace ? ELYSIA_REQUEST_ID : undefined,
		trace: hasTrace ? app.event.trace?.map((x) => x?.fn ?? x) : undefined,
		mapEarlyResponse: mapEarlyResponse
	})
}
