import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './Cast.css';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface Project {
  id: string;
  project_key: string;
  client_name_raw: string;
  client_name: string;
  work_date: string;
  work_name: string;
  location: string;
  status: string;
  unique_url: string;
  url_expires_at: string;
}

interface User {
  id: string;
  email: string;
  name: string;
}

export default function CastToday() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [date, setDate] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('castToken');
    if (!token) {
      navigate('/cast/login');
      return;
    }

    fetch(`${API_BASE}/api/cast/today`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })
      .then((res) => {
        if (res.status === 401) {
          localStorage.removeItem('castToken');
          localStorage.removeItem('castUser');
          navigate('/cast/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) {
          setUser(data.user);
          setProjects(data.projects);
          setDate(data.date);
        }
      })
      .catch(() => {
        setError('データの取得に失敗しました');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [navigate]);

  const handleLogout = async () => {
    const token = localStorage.getItem('castToken');
    if (token) {
      await fetch(`${API_BASE}/api/cast/logout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
    }
    localStorage.removeItem('castToken');
    localStorage.removeItem('castUser');
    navigate('/cast/login');
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
  };

  if (loading) {
    return (
      <div className="cast-container">
        <div className="cast-card">
          <div className="cast-logo">ほうこちゃん</div>
          <p>読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cast-container">
      <div className="cast-card wide">
        <div className="cast-header">
          <div className="cast-logo">ほうこちゃん</div>
          <button className="cast-logout" onClick={handleLogout}>
            ログアウト
          </button>
        </div>

        <h1>今日の現場</h1>
        {user && <p className="cast-user-name">{user.name} さん</p>}
        <p className="cast-date">{date && formatDate(date)}</p>

        {error && <p className="cast-message error">{error}</p>}

        {projects.length === 0 ? (
          <div className="cast-no-projects">
            <p>今日の現場はありません</p>
          </div>
        ) : (
          <div className="cast-projects">
            {projects.map((project) => (
              <div key={project.id} className="cast-project-card">
                <div className="cast-project-header">
                  <span className="cast-project-client">
                    {project.client_name || project.client_name_raw}
                  </span>
                </div>
                <h3 className="cast-project-name">{project.work_name}</h3>
                <p className="cast-project-location">{project.location}</p>
                {project.unique_url && (
                  <a 
                    href={`/report/${project.unique_url}?email=${encodeURIComponent(user?.email || '')}`}
                    className="cast-project-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    報告画面を開く
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
