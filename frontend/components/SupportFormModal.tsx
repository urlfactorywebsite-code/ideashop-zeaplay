import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { SupportIcon, XMarkIcon } from './icons';
import { User } from '../types';

interface SupportFormModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WEBHOOK_URL = 'https://n8n.urlfactory.website/webhook/task-support';

const categories = ['Bug', 'Feature Request', 'Access Issue', 'Other'];
const priorities = ['Low', 'Medium', 'High', 'Critical'];

const SupportFormModal: React.FC<SupportFormModalProps> = ({ isOpen, onClose }) => {
  const { user: currentUser } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [employerId, setEmployerId] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [description, setDescription] = useState('');
const [attachment, setAttachment] = useState<string | null>(null);
const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (isOpen && currentUser) {
      setName(currentUser.name || '');
      setEmail(currentUser.email || '');
      setEmployerId(currentUser.employerId || '');
    } else if (isOpen) {
      resetForm();
    }
  }, [isOpen, currentUser]);

  const resetForm = () => {
    setName(currentUser?.name || '');
    setEmail(currentUser?.email || '');
    setEmployerId(currentUser?.employerId || '');
    setSubject('');
    setCategory('');
    setPriority('');
    setDescription('');
    setAttachment(null);
    setSelectedFile(null);
    setError('');
    setSuccess('');
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        setError('Only images and PDFs are allowed.');
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAttachment(reader.result as string);
      };
      reader.readAsDataURL(file);
      setError('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !subject || !description || !category || !priority) {
      setError('Please fill in all required fields.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const fileType = selectedFile ? (selectedFile.type.startsWith('image/') ? 'image' : 'pdf') : null;
      const payload = {
        name: name || null,
        email,
        employerId: employerId || null,
        subject,
        category,
        priority,
        description,
        attachment: attachment || null,
        fileType,
        submittedAt: new Date().toISOString(),
        ...(currentUser && { user_id: currentUser.id }),
      };

      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to send request');
      }

      setSuccess('Your support request has been sent successfully.');
      setTimeout(() => {
        resetForm();
        onClose();
      }, 2000);
    } catch (err: any) {
      setError('Something went wrong, please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldClass =
    'w-full rounded-2xl border border-white/15 bg-black/40 px-4 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70';
  const areaClass =
    'w-full rounded-2xl border border-white/15 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/60 focus:outline-none focus:ring-2 focus:ring-primary/70';
  const labelClass = 'text-xs uppercase tracking-[0.25em] text-white/50';
  const sectionClass = 'rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative flex h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-white/15 bg-gradient-to-br from-slate-950/95 via-slate-900/95 to-slate-950/95 text-white shadow-[0_40px_80px_rgba(15,23,42,0.65)]">
        <div className="pointer-events-none absolute -right-16 top-0 h-64 w-64 rounded-full bg-primary/25 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-60 w-60 rounded-full bg-emerald-500/20 blur-3xl" />

        <header className="relative border-b border-white/10 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <SupportIcon className="h-6 w-6 text-primary" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/60">Help Center</p>
                <h2 className="mt-2 text-2xl font-bold drop-shadow">Submit Support Request</h2>
                <p className="mt-2 max-w-lg text-sm text-white/70">
                  Help us help you by providing details about your issue or feedback.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/30 bg-black/30 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/15"
              >
                Cancel
              </button>
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-y-auto px-6 py-6">
          <form onSubmit={handleSubmit} className="space-y-6 text-white">
            <section className={sectionClass}>
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Personal Info</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="name" className={labelClass}>Name (Optional)</label>
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`${fieldClass} mt-2`}
                  />
                </div>
                <div>
                  <label htmlFor="email" className={labelClass}>Email *</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={`${fieldClass} mt-2`}
                  />
                </div>
                <div>
                  <label htmlFor="employerId" className={labelClass}>Employer ID (Optional)</label>
                  <input
                    id="employerId"
                    type="text"
                    value={employerId}
                    onChange={(e) => setEmployerId(e.target.value)}
                    className={`${fieldClass} mt-2`}
                  />
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Issue Details</p>
              <div className="mt-4 space-y-4">
                <div>
                  <label htmlFor="subject" className={labelClass}>Subject *</label>
                  <input
                    id="subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    className={`${fieldClass} mt-2`}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor="category" className={labelClass}>Category *</label>
                    <select
                      id="category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      required
                      className={`${fieldClass} mt-2`}
                    >
                      <option value="">Select category</option>
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="priority" className={labelClass}>Priority *</label>
                    <select
                      id="priority"
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      required
                      className={`${fieldClass} mt-2`}
                    >
                      <option value="">Select priority</option>
                      {priorities.map((pri) => (
                        <option key={pri} value={pri}>
                          {pri}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="description" className={labelClass}>Description *</label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    required
                    className={`${areaClass} mt-2`}
                  />
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <p className="text-xs uppercase tracking-[0.3em] text-white/60">Attachment (Optional) - Images and PDFs only</p>
              <div className="mt-4">
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className={`${fieldClass} mt-2 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/20 file:text-primary hover:file:bg-primary/30`}
                />
                {selectedFile && (
                  <p className="mt-2 text-sm text-white/70">
                    Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB) - Type: {selectedFile.type.startsWith('image/') ? 'image' : 'pdf'}
                  </p>
                )}
              </div>
            </section>

            {error && <p className="text-sm font-semibold text-rose-300">{error}</p>}
            {success && <p className="text-sm font-semibold text-emerald-400">{success}</p>}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-white/30 bg-black/30 px-5 py-2 text-sm font-semibold text-white transition hover:border-white/60 hover:bg-white/15"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/20 px-5 py-2 text-sm font-semibold text-primary transition hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Sending...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SupportFormModal;
