import { inject, provide } from 'vue'

const PRICING_PAGE_CONTEXT = Symbol('pricing-page-context')

export function providePricingPageContext(context: Record<string, any>) {
  provide(PRICING_PAGE_CONTEXT, context)
}

export function usePricingPageContext(): Record<string, any> {
  const context = inject<Record<string, any>>(PRICING_PAGE_CONTEXT)
  if (!context) throw new Error('Pricing page context is unavailable')
  return context
}
