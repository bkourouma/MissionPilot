"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useAttenteRafraichissement } from "../../../../components/formulaires/useAttenteRafraichissement";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../components/ui/Alerte";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { Carte } from "../../../../components/ui/Carte";
import { Champ } from "../../../../components/ui/Champ";
import { api } from "../../../../lib/api";
import {
  JOURNAL_LIBELLES,
  validerPlan,
  type PlanComptable as Plan,
  type SaisiePlan,
} from "../../../../lib/export-comptable";

const saisieDepuis = (p: Plan): SaisiePlan => ({
  comptes: Object.fromEntries(p.comptes.map((c) => [c.cle, c.compte])),
  journaux: Object.fromEntries(p.journaux.map((j) => [j.cle, j.code])),
  valeurs_validees: p.valeurs_validees,
});

/** Plan comptable du cabinet (comptes SYSCOHADA de départ, modifiables) et codes journaux. */
export function PlanComptable({ plan: p }: { plan: Plan }) {
  const cle = JSON.stringify(saisieDepuis(p));
  const [s, setS] = useState<SaisiePlan>(() => saisieDepuis(p));
  const [info, setInfo] = useState<string | null>(null);
  const form = useFormulaire<string>();
  const [attente, marquer] = useAttenteRafraichissement(cle);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setInfo(null);
    const v = validerPlan(s, p);
    if (v.ok && v.inchange) {
      setInfo("Aucune modification à enregistrer.");
      return;
    }
    await form.envoyer(v, (c) => api.patch("/api/finance/plan-comptable", c), {
      succes: "Plan comptable enregistré.",
      apres: marquer,
    });
  }

  return (
    <Carte titre="Plan comptable du cabinet">
      <form
        ref={form.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={soumettre}
        aria-label="Plan comptable du cabinet"
      >
        {p.valeurs_validees ? (
          <Alerte tonalite="succes" annonce="aucune" titre="Plan validé par le cabinet">
            <p>Les comptes ont été confirmés par l&apos;expert-comptable du cabinet.</p>
          </Alerte>
        ) : (
          <Alerte
            tonalite="attention"
            annonce="aucune"
            titre="Valeurs de départ à valider par un expert-comptable"
          >
            <p>
              Comptes proposés selon le SYSCOHADA révisé. Faites-les vérifier par
              l&apos;expert-comptable du cabinet (notamment les débours refacturés et les retenues à
              la source), puis cochez « Plan validé ».
            </p>
          </Alerte>
        )}
        <RetourFormulaire
          erreur={form.erreurGlobale}
          succes={form.succes ?? info}
          refAlerte={form.refAlerte}
        />
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">Comptes</legend>
          <div className="mp-grille-champs mp-grille-champs--serree">
            {p.comptes.map((c) => (
              <Champ
                key={c.cle}
                libelle={c.libelle}
                aide={`Valeur de départ : ${c.valeur_de_depart}`}
                autoCapitalize="characters"
                maxLength={12}
                value={s.comptes[c.cle] ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, comptes: { ...x.comptes, [c.cle]: e.target.value } }))
                }
                erreur={form.erreurs[`compte_${c.cle}`]}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="mp-groupe">
          <legend className="mp-champ__libelle">Codes journaux</legend>
          <div className="mp-grille-champs mp-grille-champs--serree">
            {p.journaux.map((j) => (
              <Champ
                key={j.cle}
                libelle={JOURNAL_LIBELLES[j.cle]}
                aide={`Valeur de départ : ${j.valeur_de_depart}`}
                autoCapitalize="characters"
                maxLength={6}
                value={s.journaux[j.cle] ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, journaux: { ...x.journaux, [j.cle]: e.target.value } }))
                }
                erreur={form.erreurs[`journal_${j.cle}`]}
              />
            ))}
          </div>
        </fieldset>
        <CaseACocher
          libelle="Plan validé par l'expert-comptable du cabinet"
          checked={s.valeurs_validees}
          onChange={(e) => setS((x) => ({ ...x, valeurs_validees: e.target.checked }))}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            chargement={form.enCours || attente}
            texteChargement="Enregistrement…"
          >
            Enregistrer le plan comptable
          </Bouton>
        </div>
      </form>
    </Carte>
  );
}
