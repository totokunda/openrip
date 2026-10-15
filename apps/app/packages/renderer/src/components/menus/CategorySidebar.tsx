import React from "react";
import { cn } from "@/lib/utils";
import { LuChevronLeft } from "react-icons/lu";
import { TbCategory } from "react-icons/tb";

interface CategorySidebarProps {
  categories: string[];
  activeCategory: string | null;
  onCategoryClick: (category: string) => void;
  className?: string;
  title?: string;
  initiallyCollapsed?: boolean;
  persistenceKey?: string;
}

const CategorySidebar: React.FC<CategorySidebarProps> = ({
  categories,
  activeCategory,
  onCategoryClick,
  className,
  title = "CATEGORIES",
  initiallyCollapsed = false,
  persistenceKey,
}) => {
  const storageKey = React.useMemo(() => {
    return persistenceKey || `CategorySidebar:${title}`;
  }, [persistenceKey, title]);
  const [collapsed, setCollapsed] = React.useState<boolean>(() => {
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(storageKey)
          : null;
      if (raw === "1") return true;
      if (raw === "0") return false;
    } catch {}
    return initiallyCollapsed;
  });
  React.useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, collapsed ? "1" : "0");
    } catch {}
  }, [collapsed, storageKey]);

  return (
    <div
      className={cn(
        "flex flex-col  bg-brand/50 transition-all duration-200 border-r border-brand-light/5",
        collapsed ? "min-w-8 w-8" : "min-w-36 w-36",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between flex-shrink-0 px-2.5 pt-2",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed && (
          <div className="text-[9px] text-brand-light/60 text-start font-medium">
            {title}
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={cn(
            " text-brand-light/70 hover:text-brand-light transition-colors rounded-md block",
          )}
          aria-label={collapsed ? "Expand categories" : "Collapse categories"}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <TbCategory className="w-3.5 h-3.5" />
          ) : (
            <LuChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-y-1 px-1 pb-2 pt-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => onCategoryClick(category)}
              className={cn(
                "text-start w-full p-[5.5px] px-2 rounded text-[10.5px] font-medium text-brand-light/80 hover:text-brand-light hover:bg-brand transition-colors truncate",
                {
                  "bg-brand-background-light/80 text-brand-light":
                    activeCategory === category,
                },
              )}
              title={category}
              type="button"
            >
              {category}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CategorySidebar;
