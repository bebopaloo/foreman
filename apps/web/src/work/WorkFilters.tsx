import type { WorkItemsResponse } from "@foreman/shared";
import { PRIORITIES, ISSUE_TYPES } from "@foreman/shared";
import type { FilterKey, WorkFilters as Filters } from "./url-state.ts";

interface Props {
  counts: WorkItemsResponse["counts"];
  filters: Filters;
  repos: readonly { id: string; fullName: string }[];
  setFilter: (key: FilterKey, value: string | null) => void;
  states: readonly string[];
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="filter-select">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function WorkFilters({ counts, filters, repos, setFilter, states }: Props) {
  const chips: { label: string; value: string | null; count: number }[] = [
    { label: "All", value: null, count: counts.all },
    ...states.map((state) => ({
      label: state,
      value: state,
      count: counts[state as keyof typeof counts],
    })),
    { label: "No issue", value: "none", count: counts.none },
  ];
  const optional = (key: "type" | "priority" | "repo") => (value: string) => {
    setFilter(key, value === "" ? null : value);
  };
  return (
    <div className="work-filters">
      <div role="group" aria-label="Filter by Issue state" className="chips">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={(filters.issue_state ?? null) === chip.value}
            onClick={() => {
              setFilter("issue_state", chip.value);
            }}
          >
            {`${chip.label} ${chip.count.toString()}`}
          </button>
        ))}
      </div>
      <div className="selects">
        <Select
          label="Type"
          value={filters.type ?? ""}
          options={[
            ["", "All types"],
            ...ISSUE_TYPES.map((type) => [type, type] as const),
            ["multiple", "multiple"],
            ["none", "no type"],
          ]}
          onChange={optional("type")}
        />
        <Select
          label="Priority"
          value={filters.priority ?? ""}
          options={[
            ["", "All priorities"],
            ...PRIORITIES.map((priority) => [priority, priority] as const),
            ["none", "none"],
          ]}
          onChange={optional("priority")}
        />
        <Select
          label="Repo"
          value={filters.repo ?? ""}
          options={[["", "All repos"], ...repos.map((repo) => [repo.id, repo.fullName] as const)]}
          onChange={optional("repo")}
        />
        <Select
          label="Sort"
          value={filters.sort}
          options={[
            ["repo", "Repo"],
            ["priority", "Priority"],
            ["state", "Issue state"],
          ]}
          onChange={(value) => {
            setFilter("sort", value === "repo" ? null : value);
          }}
        />
      </div>
    </div>
  );
}
