import React, { useState } from 'react';
import { Plus, X, Edit2, Trash2, Check, Hash } from 'lucide-react';

interface CategoryManagerProps {
  categories: string[];
  onAddCategory: (name: string) => void;
  onUpdateCategory: (oldName: string, newName: string) => void;
  onDeleteCategory: (name: string) => void;
  onClose: () => void;
  triggerToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export default function CategoryManager({
  categories,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onClose,
  triggerToast,
}: CategoryManagerProps) {
  const [newCategory, setNewCategory] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleAdd = () => {
    const name = newCategory.trim();
    if (!name) {
      triggerToast('Category name is required', 'error');
      return;
    }
    if (categories.includes(name)) {
      triggerToast('Category already exists', 'error');
      return;
    }
    onAddCategory(name);
    setNewCategory('');
    triggerToast(`Added "${name}" category`, 'success');
  };

  const handleStartEdit = (name: string) => {
    setEditingName(name);
    setEditValue(name);
  };

  const handleSaveEdit = () => {
    if (!editingName) return;
    const name = editValue.trim();
    if (!name) {
      triggerToast('Category name is required', 'error');
      return;
    }
    if (name !== editingName && categories.includes(name)) {
      triggerToast('Category already exists', 'error');
      return;
    }
    onUpdateCategory(editingName, name);
    setEditingName(null);
    triggerToast(`Renamed to "${name}"`, 'success');
  };

  const handleDelete = (name: string) => {
    onDeleteCategory(name);
    setDeleteConfirm(null);
    triggerToast(`Deleted "${name}" category`, 'info');
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="boss-card w-full max-w-md p-6 bg-zinc-950 border border-white/5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center pb-3 border-b border-white/5">
          <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
            <Hash className="w-5 h-5 text-gold-brand" /> Manage Categories
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-2">
          <input type="text" value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New category name..." onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1 bg-zinc-900 border border-zinc-800 text-gold-light rounded-xl h-10 px-3 text-xs focus:border-gold-brand focus:outline-none" />
          <button onClick={handleAdd}
            className="h-10 px-4 bg-gold-brand hover:bg-gold-medium text-black font-black uppercase tracking-widest text-xs rounded-xl flex items-center gap-1.5 shadow-lg">
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {categories.map(cat => (
            <div key={cat}
              className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800/60 rounded-xl px-3 py-2.5 group hover:border-zinc-700 transition-colors">
              {editingName === cat ? (
                <div className="flex items-center gap-2 flex-1">
                  <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                    className="flex-1 bg-zinc-950 border border-gold-brand/40 text-gold-light rounded-lg h-8 px-2 text-xs focus:outline-none"
                    autoFocus />
                  <button onClick={handleSaveEdit} className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingName(null)} className="p-1 text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
                </div>
              ) : deleteConfirm === cat ? (
                <div className="flex items-center justify-between flex-1">
                  <span className="text-xs font-bold text-rose-400 uppercase">Delete "{cat}"?</span>
                  <div className="flex gap-1.5">
                    <button onClick={() => setDeleteConfirm(null)}
                      className="px-2.5 h-7 text-[10px] font-bold border border-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-900">Cancel</button>
                    <button onClick={() => handleDelete(cat)}
                      className="px-2.5 h-7 text-[10px] font-black bg-rose-600 text-white rounded-lg hover:bg-rose-500 uppercase">Delete</button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="text-xs font-bold text-zinc-300 uppercase tracking-wide">{cat}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleStartEdit(cat)}
                      className="p-1.5 text-zinc-500 hover:text-gold-brand rounded-lg hover:bg-zinc-800/50 transition-all">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteConfirm(cat)}
                      className="p-1.5 text-zinc-500 hover:text-rose-400 rounded-lg hover:bg-zinc-800/50 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="pt-2">
          <button onClick={onClose}
            className="w-full h-11 border border-zinc-800 hover:bg-zinc-900 text-zinc-400 font-bold uppercase tracking-wider text-xs rounded-xl">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
