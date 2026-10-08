"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { Select } from "../../../../components/ui/Select";
import { messageErreur } from "../../../../lib/api";
import {
  messageExport,
  nomFichierExport,
  OPTIONS_FORMATS_DATE,
  OPTIONS_SEPARATEURS,
  telechargerExport,
  validerExport,
  type ChampExport,
  type FormatDate,
  type SaisieExport,
  type Separateur,
} from "../../../../lib/export-comptable";

/**
 * Téléchargement de l'export par un appel authentifié (cookie de session) : seule la période
 * et le format partent dans l'URL de la requête, jamais une donnée comptable.
 */
export function ExportComptable({ duDefaut, auDefaut }: { duDefaut: string; auDefaut: string }) {
  const [s, setS] = useState<SaisieExport>({
    du: duDefaut,
    au: auDefaut,
    separateur: "point_virgule",
    decimale: "virgule",
    bom: true,
    format_date: "jj/mm/aaaa",
  });
  const [erreurs, setErreurs] = useState<Partial<Record<ChampExport, string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refAlerte = useRef<HTMLDivElement>(null);
  // Erreur affichée : le focus va sur l'alerte (annoncée et visible à l'écran).
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function exporter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreur(null);
    setSucces(null);
    const v = validerExport(s);
    if (!v.ok) {
      setErreurs(v.erreurs);
      return;
    }
    setErreurs({});
    setEnCours(true);
    try {
      const fichier = await telechargerExport(v.charge);
      const url = URL.createObjectURL(fichier);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nomFichierExport(s.du, s.au);
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSucces(
        "Export téléchargé. Le serveur a vérifié que chaque pièce est équilibrée (débit = crédit).",
      );
    } catch (e) {
      setErreur(messageExport(e) ?? messageErreur(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={exporter}
      aria-label="Exporter les écritures"
    >
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur="Export refusé"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Du"
          type="date"
          required
          value={s.du}
          onChange={(e) => setS((x) => ({ ...x, du: e.target.value }))}
          erreur={erreurs.periode}
        />
        <Champ
          libelle="Au"
          type="date"
          required
          value={s.au}
          aide="Deux ans au plus."
          onChange={(e) => setS((x) => ({ ...x, au: e.target.value }))}
        />
        <Select
          libelle="Séparateur de colonnes"
          options={OPTIONS_SEPARATEURS}
          value={s.separateur}
          onChange={(e) => setS((x) => ({ ...x, separateur: e.target.value as Separateur }))}
        />
        <Select
          libelle="Séparateur décimal"
          options={[
            { valeur: "virgule", libelle: "Virgule (1 500,50)" },
            { valeur: "point", libelle: "Point (1500.50)" },
          ]}
          value={s.decimale}
          onChange={(e) =>
            setS((x) => ({ ...x, decimale: e.target.value as SaisieExport["decimale"] }))
          }
          erreur={erreurs.decimale}
        />
        <Select
          libelle="Format des dates"
          options={OPTIONS_FORMATS_DATE}
          value={s.format_date}
          onChange={(e) => setS((x) => ({ ...x, format_date: e.target.value as FormatDate }))}
        />
      </div>
      <CaseACocher
        libelle="Compatible Excel (UTF-8 avec BOM)"
        aide="Les accents s'affichent correctement à l'ouverture directe dans Excel."
        checked={s.bom}
        onChange={(e) => setS((x) => ({ ...x, bom: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="telechargement"
          chargement={enCours}
          texteChargement="Préparation…"
        >
          Télécharger le fichier CSV
        </Bouton>
      </div>
    </form>
  );
}
