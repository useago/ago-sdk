import { useSearchParams } from 'react-router-dom';

const CATEGORIES = ['all', 'electronics', 'clothing', 'books', 'home', 'sports'] as const;
const SORT_OPTIONS = ['name', 'price-asc', 'price-desc', 'rating'] as const;
const STATUSES = ['all', 'in-stock', 'out-of-stock', 'preorder'] as const;

interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  rating: number;
  status: 'in-stock' | 'out-of-stock' | 'preorder';
}

const PRODUCTS: Product[] = [
  { id: 1, name: 'Wireless Headphones', category: 'electronics', price: 89, rating: 4.5, status: 'in-stock' },
  { id: 2, name: 'Running Shoes', category: 'sports', price: 120, rating: 4.2, status: 'in-stock' },
  { id: 3, name: 'TypeScript Handbook', category: 'books', price: 35, rating: 4.8, status: 'in-stock' },
  { id: 4, name: 'Cotton T-Shirt', category: 'clothing', price: 25, rating: 3.9, status: 'out-of-stock' },
  { id: 5, name: 'Smart Speaker', category: 'electronics', price: 149, rating: 4.1, status: 'preorder' },
  { id: 6, name: 'Yoga Mat', category: 'sports', price: 45, rating: 4.6, status: 'in-stock' },
  { id: 7, name: 'Desk Lamp', category: 'home', price: 65, rating: 4.3, status: 'in-stock' },
  { id: 8, name: 'React Patterns Book', category: 'books', price: 42, rating: 4.7, status: 'in-stock' },
  { id: 9, name: 'Winter Jacket', category: 'clothing', price: 180, rating: 4.4, status: 'out-of-stock' },
  { id: 10, name: 'Bluetooth Keyboard', category: 'electronics', price: 75, rating: 4.0, status: 'in-stock' },
  { id: 11, name: 'Throw Pillows Set', category: 'home', price: 38, rating: 3.8, status: 'in-stock' },
  { id: 12, name: 'Fitness Tracker', category: 'electronics', price: 199, rating: 4.6, status: 'preorder' },
];

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();

  const category = searchParams.get('category') || 'all';
  const sort = searchParams.get('sort') || 'name';
  const status = searchParams.get('status') || 'all';
  const search = searchParams.get('search') || '';
  const minPrice = Number(searchParams.get('minPrice')) || 0;
  const maxPrice = Number(searchParams.get('maxPrice')) || 999;

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all' || (key === 'minPrice' && value === '0') || (key === 'maxPrice' && value === '999')) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next);
  };

  let filtered = PRODUCTS.filter((p) => {
    if (category !== 'all' && p.category !== category) return false;
    if (status !== 'all' && p.status !== status) return false;
    if (p.price < minPrice || p.price > maxPrice) return false;
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'rating') return b.rating - a.rating;
    return a.name.localeCompare(b.name);
  });

  const activeFilterCount = [
    category !== 'all',
    status !== 'all',
    search !== '',
    minPrice > 0,
    maxPrice < 999,
  ].filter(Boolean).length;

  return (
    <div className="page products-page">
      <h2>Products</h2>
      <p className="products-subtitle">
        Ask the AI to filter products — e.g. <em>"Show me electronics under 100€"</em> or <em>"Sort by rating"</em>
      </p>

      <div className="filters-bar">
        <div className="filter-group">
          <label>Search</label>
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label>Category</label>
          <select value={category} onChange={(e) => updateFilter('category', e.target.value)} className="filter-select">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c === 'all' ? 'All categories' : c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Status</label>
          <select value={status} onChange={(e) => updateFilter('status', e.target.value)} className="filter-select">
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Price range</label>
          <div className="price-range">
            <input type="number" min={0} max={999} value={minPrice} onChange={(e) => updateFilter('minPrice', e.target.value)} className="filter-input filter-input--small" />
            <span>—</span>
            <input type="number" min={0} max={999} value={maxPrice} onChange={(e) => updateFilter('maxPrice', e.target.value)} className="filter-input filter-input--small" />
          </div>
        </div>

        <div className="filter-group">
          <label>Sort by</label>
          <select value={sort} onChange={(e) => updateFilter('sort', e.target.value)} className="filter-select">
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === 'name' ? 'Name' : s === 'price-asc' ? 'Price ↑' : s === 'price-desc' ? 'Price ↓' : 'Rating'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="products-status">
        <span>{filtered.length} product{filtered.length !== 1 ? 's' : ''}</span>
        {activeFilterCount > 0 && (
          <button className="clear-filters" onClick={() => setSearchParams({})}>
            Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      <div className="products-grid">
        {filtered.map((p) => (
          <div key={p.id} className="product-card">
            <div className="product-card__header">
              <span className="product-card__category">{p.category}</span>
              <span className={`product-card__status product-card__status--${p.status}`}>
                {p.status.replace('-', ' ')}
              </span>
            </div>
            <h3>{p.name}</h3>
            <div className="product-card__footer">
              <span className="product-card__price">{p.price}€</span>
              <span className="product-card__rating">{'★'.repeat(Math.round(p.rating))}{'☆'.repeat(5 - Math.round(p.rating))} {p.rating}</span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="products-empty">No products match your filters.</p>
        )}
      </div>
    </div>
  );
}
