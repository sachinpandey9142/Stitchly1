import React, { createContext, ReactNode, useContext, useMemo, useState } from 'react';

type CustomerDiscoveryContextType = {
  selectedCategory: string | null;
  selectedDesign: string | null;
  setSelectedCategory: (category: string | null) => void;
  setSelectedDesign: (design: string | null) => void;
};

const CustomerDiscoveryContext = createContext<CustomerDiscoveryContextType | undefined>(undefined);

export function CustomerDiscoveryProvider({ children }: { children: ReactNode }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>('lehenga');
  const [selectedDesign, setSelectedDesign] = useState<string | null>(null);

  const value = useMemo(
    () => ({
      selectedCategory,
      selectedDesign,
      setSelectedCategory,
      setSelectedDesign,
    }),
    [selectedCategory, selectedDesign]
  );

  return <CustomerDiscoveryContext.Provider value={value}>{children}</CustomerDiscoveryContext.Provider>;
}

export function useCustomerDiscovery() {
  const context = useContext(CustomerDiscoveryContext);
  if (!context) {
    throw new Error('useCustomerDiscovery must be used inside CustomerDiscoveryProvider');
  }
  return context;
}
